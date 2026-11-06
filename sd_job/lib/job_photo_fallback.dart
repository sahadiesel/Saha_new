import 'package:flutter/material.dart';

class JobPhotoFallback extends StatelessWidget {
  const JobPhotoFallback({super.key});

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.blueGrey.shade100,
      child: Center(child: Icon(Icons.image_outlined, size: 42, color: Colors.blueGrey.shade400)),
    );
  }
}

class JobPhotoBadge extends StatelessWidget {
  const JobPhotoBadge({super.key, required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(6)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
      ),
    );
  }
}
