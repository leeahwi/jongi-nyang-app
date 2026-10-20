#!/usr/bin/env swift
// Usage: swift scripts/prepare-pet-art.swift INPUT_DIR OUTPUT_DIR [pose...]
// Normalizes transparent square pet pose PNGs to 1024x1024 without changing pose proportions.

import AppKit
import Foundation

let canvas = 1024
let alphaCutoff: UInt8 = 8
let topPadding = 32

struct Failure: Error, CustomStringConvertible { let description: String }
struct Bounds {
    var minX: Int, minY: Int, maxX: Int, maxY: Int
    var width: Int { maxX - minX + 1 }
    var height: Int { maxY - minY + 1 }
    var text: String { "(\(minX),\(minY))-(\(maxX),\(maxY)) \(width)x\(height)" }
}

func fail(_ message: String) throws -> Never { throw Failure(description: message) }

func loadPNG(_ url: URL) throws -> CGImage {
    let pngSignature = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    guard let data = try? Data(contentsOf: url),
          data.prefix(8) == pngSignature,
          let rep = NSBitmapImageRep(data: data),
          let image = rep.cgImage else {
        try fail("invalid PNG: \(url.path)")
    }
    guard image.width == image.height else {
        try fail("\(url.lastPathComponent) must be square, got \(image.width)x\(image.height)")
    }
    return image
}

func render(_ image: CGImage, scale: Double = 1, x: Double = 0, y: Double = 0, size: Int = canvas) throws -> (CGImage, [UInt8]) {
    var pixels = [UInt8](repeating: 0, count: size * size * 4)
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    let info = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
    try pixels.withUnsafeMutableBytes { rawBuffer in
        guard let baseAddress = rawBuffer.baseAddress,
              let ctx = CGContext(data: baseAddress, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: colorSpace, bitmapInfo: info) else {
            try fail("could not create bitmap context")
        }
        ctx.interpolationQuality = .high
        ctx.clear(CGRect(x: 0, y: 0, width: size, height: size))
        ctx.draw(image, in: CGRect(x: x, y: y, width: Double(size) * scale, height: Double(size) * scale))
    }

    let data = Data(pixels)
    guard let provider = CGDataProvider(data: data as CFData),
          let output = CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4, space: colorSpace, bitmapInfo: CGBitmapInfo(rawValue: info), provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else {
        try fail("could not create output image")
    }
    return (output, pixels)
}

func nativePixels(_ image: CGImage) throws -> [UInt8] {
    var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    let info = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
    try pixels.withUnsafeMutableBytes { rawBuffer in
        guard let baseAddress = rawBuffer.baseAddress,
              let ctx = CGContext(data: baseAddress, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: colorSpace, bitmapInfo: info) else {
            try fail("could not create bitmap context")
        }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    }
    return pixels
}

func alphaBounds(_ pixels: [UInt8], size: Int) -> Bounds? {
    var result: Bounds?
    for y in 0..<size {
        for x in 0..<size where pixels[(y * size + x) * 4 + 3] > alphaCutoff {
            if var b = result {
                b.minX = min(b.minX, x); b.minY = min(b.minY, y)
                b.maxX = max(b.maxX, x); b.maxY = max(b.maxY, y)
                result = b
            } else {
                result = Bounds(minX: x, minY: y, maxX: x, maxY: y)
            }
        }
    }
    return result
}

func hasClearPixel(_ pixels: [UInt8]) -> Bool {
    stride(from: 3, to: pixels.count, by: 4).contains { pixels[$0] == 0 }
}

func hasOpaqueContent(_ pixels: [UInt8]) -> Bool {
    stride(from: 3, to: pixels.count, by: 4).contains { pixels[$0] >= 250 }
}

func poseName(_ arg: String) -> String {
    let name = URL(fileURLWithPath: arg).lastPathComponent
    return name.hasSuffix(".png") ? String(name.dropLast(4)) : name
}

func writePNG(_ image: CGImage, to url: URL) throws {
    guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        try fail("could not encode PNG")
    }
    try data.write(to: url, options: .atomic)
}

func process(_ pose: String, inputDir: URL, outputDir: URL) throws {
    let baseline = pose == "cheer" ? 870 : 952
    let image = try loadPNG(inputDir.appendingPathComponent("\(pose).png"))
    let originalPixels = try nativePixels(image)
    guard alphaBounds(originalPixels, size: image.width) != nil else { try fail("\(pose): no alpha content") }
    guard hasOpaqueContent(originalPixels) else { try fail("\(pose): no sufficiently opaque content") }
    guard hasClearPixel(originalPixels) else { try fail("\(pose): no fully transparent background pixel") }

    let (normalized, normalizedPixels) = try render(image)
    guard let normalizedBounds = alphaBounds(normalizedPixels, size: canvas) else {
        try fail("\(pose): no content after normalization")
    }

    var scale = 1.0
    if normalizedBounds.minY + baseline - normalizedBounds.maxY < topPadding {
        scale = min(1, Double(baseline - topPadding) / Double(normalizedBounds.height - 1))
    }

    let x = (Double(canvas) - Double(canvas) * scale) / 2
    let y = Double(canvas) - Double(canvas) * scale + Double(normalizedBounds.maxY) * scale - Double(baseline)
    let (finalImage, finalPixels) = try render(normalized, scale: scale, x: x, y: y)
    guard let finalBounds = alphaBounds(finalPixels, size: canvas) else { try fail("\(pose): no content after alignment") }
    guard abs(finalBounds.maxY - baseline) <= 1 else {
        try fail("\(pose): baseline \(finalBounds.maxY) is not within 1px of \(baseline)")
    }
    guard finalBounds.minX > 0, finalBounds.minY >= topPadding - 1, finalBounds.maxX < canvas - 1, finalBounds.maxY < canvas - 1 else {
        try fail("\(pose): alpha touches canvas edge after alignment: \(finalBounds.text)")
    }

    try writePNG(finalImage, to: outputDir.appendingPathComponent("\(pose).png"))
    print("\(pose): \(image.width)x\(image.height) -> 1024x1024; normalized=\(normalizedBounds.text); output=\(finalBounds.text); baseline=\(baseline); scale=\(String(format: "%.4f", scale))")
}

func listedPoses(in inputDir: URL) throws -> [String] {
    try FileManager.default.contentsOfDirectory(at: inputDir, includingPropertiesForKeys: nil)
        .filter { $0.pathExtension.lowercased() == "png" }
        .map { poseName($0.lastPathComponent) }
        .sorted()
}

do {
    let args = CommandLine.arguments
    guard args.count >= 3 else { try fail("usage: swift scripts/prepare-pet-art.swift INPUT_DIR OUTPUT_DIR [pose...]") }
    let inputDir = URL(fileURLWithPath: args[1], isDirectory: true)
    let outputDir = URL(fileURLWithPath: args[2], isDirectory: true)
    try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
    let poses = args.count > 3 ? args.dropFirst(3).map(poseName) : try listedPoses(in: inputDir)
    guard !poses.isEmpty else { try fail("no PNG poses found in \(inputDir.path)") }
    for pose in poses { try process(pose, inputDir: inputDir, outputDir: outputDir) }
} catch {
    fputs("prepare-pet-art: \(error)\n", stderr)
    exit(1)
}
