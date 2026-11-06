import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:web/web.dart' as web;

import 'data_location.dart';
import 'job_photo_fallback.dart';

export 'job_photo_fallback.dart';

class JobPhoto extends StatelessWidget {
  const JobPhoto({
    super.key,
    this.url,
    this.width,
    this.height,
    this.topLeft,
    this.topRight,
    this.topLeftColor,
    this.topRightColor,
  });

  final String? url;
  final double? width;
  final double? height;
  final String? topLeft;
  final String? topRight;
  final Color? topLeftColor;
  final Color? topRightColor;

  @override
  Widget build(BuildContext context) {
    final photoUrl = url;
    if (photoUrl == null || photoUrl.isEmpty) {
      return SizedBox(
        width: width,
        height: height,
        child: Stack(
          fit: StackFit.expand,
          children: [
            const JobPhotoFallback(),
            if (topLeft != null && topLeftColor != null)
              Positioned(top: 8, left: 8, child: JobPhotoBadge(text: topLeft!, color: topLeftColor!)),
            if (topRight != null && topRightColor != null)
              Positioned(top: 8, right: 8, child: JobPhotoBadge(text: topRight!, color: topRightColor!)),
          ],
        ),
      );
    }
    return SizedBox(
      width: width,
      height: height,
      child: HtmlElementView.fromTagName(
        tagName: 'div',
        hitTestBehavior: PlatformViewHitTestBehavior.transparent,
        onElementCreated: (element) {
          final host = element as web.HTMLElement;
          host.style
            ..position = 'relative'
            ..width = '100%'
            ..height = '100%'
            ..overflow = 'hidden'
            ..backgroundColor = '#cfd8dc';
          final image = web.HTMLImageElement()..src = storageFileUrl(photoUrl);
          image.style
            ..position = 'absolute'
            ..inset = '0'
            ..width = '100%'
            ..height = '100%'
            ..objectFit = 'cover'
            ..display = 'block';
          host.append(image);
          _badge(host, topLeft, topLeftColor, true);
          _badge(host, topRight, topRightColor, false);
        },
      ),
    );
  }
}

void _badge(web.HTMLElement host, String? text, Color? color, bool left) {
  if (text == null || color == null) return;
  final label = web.HTMLSpanElement()..textContent = text;
  label.style
    ..position = 'absolute'
    ..top = '8px'
    ..left = left ? '8px' : 'auto'
    ..right = left ? 'auto' : '8px'
    ..backgroundColor = _css(color)
    ..color = 'white'
    ..fontSize = '12px'
    ..fontWeight = '700'
    ..padding = '4px 8px'
    ..borderRadius = '6px'
    ..fontFamily = '"Leelawadee UI", Tahoma, sans-serif'
    ..pointerEvents = 'none';
  host.append(label);
}

String _css(Color color) {
  final argb = color.toARGB32();
  final red = (argb >> 16) & 0xff;
  final green = (argb >> 8) & 0xff;
  final blue = argb & 0xff;
  return 'rgb($red,$green,$blue)';
}
