import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'history_page.dart';
import 'intake_page.dart';
import 'jobs_page.dart';
import 'staff_session.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key, required this.staff});

  final StaffSession staff;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Sahadiesel MoBile App'),
          actions: [
            IconButton(
              tooltip: 'ออกจากระบบ',
              onPressed: () => FirebaseAuth.instance.signOut(),
              icon: const Icon(Icons.logout),
            ),
          ],
          bottom: const TabBar(
            isScrollable: true,
            tabs: [
              Tab(text: 'เปิดงานใหม่'),
              Tab(text: 'งานทั้งหมด'),
              Tab(text: 'ประวัติงานซ่อม'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            IntakePage(displayName: staff.displayName),
            JobsPage(staff: staff),
            HistoryPage(staff: staff),
          ],
        ),
      ),
    );
  }
}
