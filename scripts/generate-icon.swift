import AppKit

let size = NSSize(width: 512, height: 512)
let image = NSImage(size: size)
image.lockFocus()

NSColor(calibratedRed: 0.12, green: 0.16, blue: 0.25, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 512, height: 512), xRadius: 112, yRadius: 112).fill()

let prompt = NSBezierPath()
prompt.lineWidth = 35
prompt.lineCapStyle = .round
prompt.lineJoinStyle = .round
prompt.move(to: NSPoint(x: 116, y: 332))
prompt.line(to: NSPoint(x: 209, y: 256))
prompt.line(to: NSPoint(x: 116, y: 180))
NSColor.white.setStroke()
prompt.stroke()

let cursor = NSBezierPath()
cursor.lineWidth = 35
cursor.lineCapStyle = .round
cursor.move(to: NSPoint(x: 255, y: 173))
cursor.line(to: NSPoint(x: 376, y: 173))
cursor.stroke()

image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
let png = bitmap.representation(using: .png, properties: [:])!
try png.write(to: URL(fileURLWithPath: "assets/icon.png"))
