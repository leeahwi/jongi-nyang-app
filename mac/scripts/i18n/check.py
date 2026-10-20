#!/usr/bin/env python3
"""Checks the app's translations against the texts in the code.

The code is written in Korean; every Korean text the app shows is a key into
Resources/<lang>.lproj/Localizable.strings (or .stringsdict for counts). The Swift compiler
lists the keys (-emit-localized-strings, see check.sh); this script then fails when

  * a Korean key has no English or Dutch translation,
  * a translation's placeholders (%@, %lld, %1$@ …) don't match its key,
  * a translation still has Hangul in it (other than the app's name, 종이냥),
  * a Korean string literal in Sources/PaperTodo isn't looked up at all (not a SwiftUI text,
    not L("…")) — mark a line `// ko-only` when it must stay Korean (a file name, say).

Keys without Hangul ("D-3", "%lld / %lld") need no translation; tables may still give one.
Texts live in Localizable unless the same Korean needs two translations: then String(localized:
table:) puts one in its own table (<table>.strings next to Localizable.strings).
Usage: check.py <stringsdata dir> <Sources/PaperTodo> <Resources> [--list]
"""
import json
import os
import re
import subprocess
import sys

HANGUL = re.compile('[가-힣ㄱ-ㆎ]')
LANGUAGES = ['en', 'nl']
SPEC = re.compile(r'%(?:(\d+)\$)?(#@\w+@|lld|ld|d|@|\.?\d*f|%)')


def load_plist(path):
    if not os.path.exists(path) or not open(path, encoding='utf-8').read().strip():
        return {}
    out = subprocess.run(['plutil', '-convert', 'json', '-o', '-', path], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f'Cannot read {path}: {out.stderr.strip()}')
    return json.loads(out.stdout or '{}')


def specs(text):
    """The placeholders in order of their argument: ['@', 'lld'] — %% left out."""
    found, position = [], 0
    for match in SPEC.finditer(text):
        kind = match.group(2)
        if kind == '%':
            continue
        if kind.startswith('#@'):
            continue
        kind = {'ld': 'lld', 'd': 'lld'}.get(kind, kind)
        if kind.endswith('f'):
            kind = 'f'
        index = int(match.group(1)) - 1 if match.group(1) else position
        position += 1
        found.append((index, kind))
    return [kind for _, kind in sorted(found)]


def stringsdict_specs(entry):
    """A .stringsdict entry's placeholders: its format's, with each variable's own type."""
    format_key = entry.get('NSStringLocalizedFormatKey', '')
    variables = {}
    for name, rule in entry.items():
        if isinstance(rule, dict) and rule.get('NSStringFormatSpecTypeKey') == 'NSStringPluralRuleType':
            variables[name] = {'d': 'lld', 'ld': 'lld', 'lld': 'lld', '@': '@'}.get(rule.get('NSStringFormatValueTypeKey', 'lld'), 'lld')
    found, position = [], 0
    for match in SPEC.finditer(format_key):
        kind = match.group(2)
        if kind == '%':
            continue
        index = int(match.group(1)) - 1 if match.group(1) else position
        position += 1
        if kind.startswith('#@'):
            kind = variables.get(kind[2:-1], 'lld')
        kind = {'ld': 'lld', 'd': 'lld'}.get(kind, kind)
        found.append((index, kind))
    texts = [format_key] + [v for rule in entry.values() if isinstance(rule, dict) for k, v in rule.items() if k in ('zero', 'one', 'two', 'few', 'many', 'other')]
    return [kind for _, kind in sorted(found)], texts


def literals(source):
    """Every string literal in Swift source: (line, column of the opening quote, text). Follows
    interpolations, so literals inside \\( … ) come out too; skips comments."""
    found = []
    i, line, col = 0, 1, 1
    n = len(source)

    def advance(count=1):
        nonlocal i, line, col
        for _ in range(count):
            if i < n and source[i] == '\n':
                line += 1
                col = 1
            elif i < n:
                col += len(source[i].encode('utf-8'))  # the compiler counts columns in UTF-8 bytes
            i += 1

    def read_string():
        start = (line, col)
        advance()  # the quote
        text = []
        while i < n and source[i] != '"':
            if source[i] == '\\' and i + 1 < n and source[i + 1] == '(':
                text.append('%@')
                advance(2)
                read_code(until=')')
                advance()  # the closing parenthesis
            elif source[i] == '\\':
                text.append(source[i:i + 2])
                advance(2)
            else:
                text.append(source[i])
                advance()
        advance()  # the closing quote
        found.append((start[0], start[1], ''.join(text)))

    def read_code(until=None):
        depth = 0
        while i < n:
            ch = source[i]
            if source.startswith('//', i):
                while i < n and source[i] != '\n':
                    advance()
            elif source.startswith('/*', i):
                while i < n and not source.startswith('*/', i):
                    advance()
                advance(2)
            elif ch == '"':
                read_string()
            elif until and ch == '(':
                depth += 1
                advance()
            elif until and ch == ')':
                if depth == 0:
                    return
                depth -= 1
                advance()
            else:
                advance()

    read_code()
    return found


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    strings_dir, sources_dir, resources_dir = sys.argv[1:4]
    listing = '--list' in sys.argv

    # The keys the code looks up, and where — per table (Localizable, or another one when the same
    # Korean words need two translations).
    keys, located = {}, set()
    for name in sorted(os.listdir(strings_dir)):
        if not name.endswith('.stringsdata'):
            continue
        data = json.load(open(os.path.join(strings_dir, name), encoding='utf-8'))
        source = os.path.basename(data['source'])
        for table, entries in data['tables'].items():
            for entry in entries:
                keys.setdefault((table, entry['key']), []).append(f"{source}:{entry['location']['startingLine']}")
                located.add((source, entry['location']['startingLine'], entry['location']['startingColumn']))
    korean = {key for key in keys if HANGUL.search(key[1])}
    tables = sorted({table for table, _ in keys})

    problems = []

    # Korean literals the code never looks up.
    for name in sorted(os.listdir(sources_dir)):
        if not name.endswith('.swift'):
            continue
        source = open(os.path.join(sources_dir, name), encoding='utf-8').read()
        lines = source.split('\n')
        for line, column, text in literals(source):
            if not HANGUL.search(text) or 'ko-only' in lines[line - 1]:
                continue
            if (name, line, column) not in located:
                problems.append(f'not localised: {name}:{line}:{column} "{text}"')

    # The tables.
    counts = {}
    for language in LANGUAGES:
        folder = os.path.join(resources_dir, f'{language}.lproj')
        translated = set()
        for table_name in sorted(set(tables) | {f[:-8] for f in os.listdir(folder) if f.endswith('.strings') and f != 'InfoPlist.strings'}):
            table = load_plist(os.path.join(folder, f'{table_name}.strings'))
            plurals = load_plist(os.path.join(folder, f'{table_name}.stringsdict'))
            for key in sorted(set(table) & set(plurals)):
                problems.append(f'{language}: "{key}" is in both {table_name}.strings and .stringsdict')
            for table_key in sorted(k for k in korean if k[0] == table_name):
                if table_key[1] in table or table_key[1] in plurals:
                    translated.add(table_key)
                else:
                    problems.append(f'{language}: missing in {table_name}: "{table_key[1]}"  ({", ".join(keys[table_key][:2])})')
            for key, value in table.items():
                if specs(key) != specs(value):
                    problems.append(f'{language}: placeholders differ: "{key}" → "{value}"')
                if HANGUL.search(value.replace('종이냥', '')):
                    problems.append(f'{language}: Hangul in translation of "{key}": "{value}"')
            for key, entry in plurals.items():
                found, texts = stringsdict_specs(entry)
                if specs(key) != found:
                    problems.append(f'{language}: placeholders differ in {table_name}.stringsdict "{key}"')
                if any(HANGUL.search(text.replace('종이냥', '')) for text in texts):
                    problems.append(f'{language}: Hangul in {table_name}.stringsdict "{key}"')
            for key in sorted(k for k in list(table) + list(plurals) if (table_name, k) not in keys):
                print(f'warning: {language}: "{key}" in {table_name} is not used in the code')
        counts[language] = len(translated)

    if listing:
        for key in sorted(korean, key=lambda k: keys[k][0]):
            print(f'{keys[key][0]}\t{key[0]}\t{key[1]}')

    print(f'{len(keys)} keys in the code, {len(korean)} in Korean; '
          + ', '.join(f'{language} {counts[language]}/{len(korean)}' for language in LANGUAGES))
    if problems:
        print('\n'.join(problems))
        print(f'{len(problems)} problem(s)')
        sys.exit(1)
    print('All texts are translated.')


if __name__ == '__main__':
    main()
