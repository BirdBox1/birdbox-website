import PDFKit
import AppKit
// usage: pdfx <pdf> <outdir> <scale>
let a = CommandLine.arguments
let doc = PDFDocument(url: URL(fileURLWithPath: a[1]))!
let out = a[2]; let scale = CGFloat(Double(a[3]) ?? 1.5)
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
var txt = ""
for i in 0..<doc.pageCount {
  let p = doc.page(at: i)!
  txt += "\n=== PAGE \(i+1) ===\n" + (p.string ?? "")
  let b = p.bounds(for: .mediaBox)
  let w = Int(b.width*scale), h = Int(b.height*scale)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  let ctx = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = ctx
  ctx.cgContext.setFillColor(NSColor.white.cgColor); ctx.cgContext.fill(CGRect(x:0,y:0,width:w,height:h))
  ctx.cgContext.scaleBy(x: scale, y: scale)
  p.draw(with: .mediaBox, to: ctx.cgContext)
  ctx.flushGraphics()
  let png = rep.representation(using: .png, properties: [:])!
  try! png.write(to: URL(fileURLWithPath: String(format: "%@/p%02d.png", out, i+1)))
}
try! txt.write(toFile: out + "/text.txt", atomically: true, encoding: .utf8)
print(doc.pageCount, doc.documentAttributes ?? [:])
