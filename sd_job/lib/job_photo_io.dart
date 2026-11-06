import 'package:flutter/material.dart';

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
    final photo = url == null || url!.isEmpty
        ? const JobPhotoFallback()
        : Image.network(
            storageFileUrl(url!),
            fit: BoxFit.cover,
            errorBuilder: (context, error, stackTrace) => const JobPhotoFallback(),
          );
    return SizedBox(
      width: width,
      height: height,
      child: Stack(
        fit: StackFit.expand,
        children: [
          photo,
          if (topLeft != null && topLeftColor != null)
            Positioned(top: 8, left: 8, child: JobPhotoBadge(text: topLeft!, color: topLeftColor!)),
          if (topRight != null && topRightColor != null)
            Positioned(top: 8, right: 8, child: JobPhotoBadge(text: topRight!, color: topRightColor!)),
        ],
      ),
    );
  }
}
