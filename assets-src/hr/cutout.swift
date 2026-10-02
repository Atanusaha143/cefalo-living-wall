import Vision
import CoreImage
import AppKit
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let ci = CIImage(contentsOf: url)!
let handler = VNImageRequestHandler(ciImage: ci)
let req = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([req])
guard let obs = req.results?.first else { print("no person"); exit(1) }
let buf = try obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: handler)
let mask = CIImage(cvPixelBuffer: buf)
let ctx = CIContext()
let cg = ctx.createCGImage(mask, from: mask.extent, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())!
let rep = NSBitmapImageRep(cgImage: cg)
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
print("ok", cg.width, cg.height)
