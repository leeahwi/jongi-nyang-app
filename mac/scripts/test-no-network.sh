#!/bin/bash
# 인터넷에 연결하지 않는다는 약속 (#398): README and the privacy page say the app has no code that connects to the
# internet. This reads every Swift file in Sources/ and fails on any API that opens a connection or loads a web
# address. Links handed to the system browser (NSWorkspace.shared.open) are allowed: they are not on the list.
# The Windows app has the same check (windows/test/noNetwork.test.ts).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"

# One extended regular expression per way out. Each must also catch its sample below, so a pattern can't rot.
patterns=(
    'URLSession'
    'URLRequest'
    '(NS)?URLConnection|NSURLDownload'
    'NW(Connection|Listener|Browser|Endpoint|PathMonitor|Parameters)'
    '^[[:space:]]*import[[:space:]]+(Network|WebKit|MultipeerConnectivity|CloudKit)([[:space:]]|$)'
    'CF(Network|Stream|Socket|Host|ReadStreamCreate|WriteStreamCreate)'
    'SCNetworkReachability'
    'WKWebView'
    '(Data|String)\(contentsOf:[[:space:]]*URL\(string:'
    'NSUbiquitousKeyValueStore|CKContainer'
    '(^|[^[:alnum:]_.])(socket|getaddrinfo|gethostbyname)\('
)
samples=(
    'let task = URLSession.shared.dataTask(with: url)'
    'var request = URLRequest(url: url)'
    'NSURLConnection(request: request, delegate: self)'
    'let connection = NWConnection(host: "example.com", port: 443, using: .tls)'
    'import Network'
    'CFStreamCreatePairWithSocketToHost(nil, host, 80, &read, &write)'
    'SCNetworkReachabilityCreateWithName(nil, "example.com")'
    'let view = WKWebView(frame: .zero)'
    'let page = try String(contentsOf: URL(string: "https://example.com")!)'
    'NSUbiquitousKeyValueStore.default.set(value, forKey: key)'
    'let fd = socket(AF_INET, SOCK_STREAM, 0)'
)

failed=0
for index in "${!patterns[@]}"; do
    if ! printf '%s\n' "${samples[$index]}" | grep -Eq -- "${patterns[$index]}"; then
        echo "FAIL pattern ${patterns[$index]} misses its sample: ${samples[$index]}"
        failed=1
    fi
done
# What the app does use stays quiet: opening a link or a folder, and reading local files.
for quiet in 'NSWorkspace.shared.open(url)' 'let data = try Data(contentsOf: fileURL)' 'if let target = URL(string: url) { NSWorkspace.shared.open(target) }'; do
    for pattern in "${patterns[@]}"; do
        if printf '%s\n' "$quiet" | grep -Eq -- "$pattern"; then echo "FAIL pattern $pattern catches an allowed line: $quiet"; failed=1; fi
    done
done

count=$(find Sources -name '*.swift' | wc -l | tr -d ' ')
if [ "$count" -lt 50 ]; then echo "FAIL read only $count Swift files"; failed=1; fi
for pattern in "${patterns[@]}"; do
    # Comment lines may name what they guard against.
    hits=$(grep -rnE --include='*.swift' -- "$pattern" Sources | grep -vE '^[^:]+:[0-9]+:[[:space:]]*//' || true)
    if [ -n "$hits" ]; then
        echo "FAIL a way to the network ($pattern):"
        echo "$hits"
        failed=1
    fi
done

if [ "$failed" -ne 0 ]; then exit 1; fi
echo "PASS no Swift file in Sources/ ($count files) connects to the network; ${#patterns[@]} patterns checked"
