import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

import 'board_page.dart';
import 'data_location.dart';
import 'firebase_options.dart';
import 'staff.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: kIsWeb ? DefaultFirebaseOptions.web : DefaultFirebaseOptions.android,
  );
  runApp(const SdJobApp());
}

class SdJobApp extends StatelessWidget {
  const SdJobApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SD Job',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0B3A6A)),
        useMaterial3: true,
      ),
      home: const AuthGate(),
    );
  }
}

class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        final user = snapshot.data;
        if (user == null) return const LoginPage();
        return ProfileGate(uid: user.uid, email: user.email ?? '');
      },
    );
  }
}

class ProfileGate extends StatelessWidget {
  const ProfileGate({super.key, required this.uid, required this.email});

  final String uid;
  final String email;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: appFirestore.collection('users').doc(uid).snapshots(),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return _Blocked(message: 'อ่านโปรไฟล์ไม่สำเร็จ');
        }
        if (!snapshot.hasData) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        final data = snapshot.data!.data();
        if (data == null) return const _Blocked(message: 'ไม่พบโปรไฟล์พนักงาน');
        final name = (data['displayName'] as String?)?.trim();
        final staff = Staff(
          uid: uid,
          displayName: (name == null || name.isEmpty) ? email : name,
          role: (data['role'] as String?)?.trim() ?? '',
          department: (data['department'] as String?)?.trim(),
          status: (data['status'] as String?)?.trim(),
          linkedVendorId: (data['linkedVendorId'] as String?)?.trim(),
        );
        final access = staff.board;
        if (access.kind == BoardKind.blocked) return _Blocked(message: access.message);
        return HomePage(staff: staff);
      },
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key, required this.staff});

  final Staff staff;

  @override
  Widget build(BuildContext context) {
    final access = staff.board;
    if (access.kind == BoardKind.allShops) {
      return DefaultTabController(
        length: shopDepartments.length,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('Sahadiesel Job Manage'),
            actions: const [_LogoutButton()],
            bottom: TabBar(
              isScrollable: true,
              tabs: [for (final item in shopDepartments) Tab(text: item.$2)],
            ),
          ),
          body: TabBarView(
            children: [
              for (final item in shopDepartments) BoardPage(staff: staff, department: item.$1),
            ],
          ),
        ),
      );
    }

    final department = access.department ?? '';
    final title = access.kind == BoardKind.assignedOnly ? 'งานของฉัน' : shopLabel(department);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sahadiesel Job Manage'),
        actions: const [_LogoutButton()],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Text(title, style: Theme.of(context).textTheme.titleMedium),
          ),
          Expanded(
            child: BoardPage(staff: staff, department: department, assigneeUid: access.assigneeUid),
          ),
        ],
      ),
    );
  }
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: _email.text.trim(),
        password: _password.text,
      );
    } on FirebaseAuthException catch (error) {
      setState(() => _error = error.code == 'invalid-credential' || error.code == 'wrong-password' || error.code == 'user-not-found'
          ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
          : 'เข้าสู่ระบบไม่สำเร็จ');
    } catch (_) {
      setState(() => _error = 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sahadiesel Job Manage')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text('SD Job', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 8),
          const Text('ดูงานที่รับเข้าแล้ว ใช้อีเมลพนักงานชุดเดียวกับเว็บ'),
          const SizedBox(height: 24),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'อีเมล', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _password,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'รหัสผ่าน', border: OutlineInputBorder()),
            onSubmitted: (_) => _busy ? null : _signIn(),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _signIn,
            child: Text(_busy ? 'กำลังเข้า...' : 'เข้าสู่ระบบ'),
          ),
        ],
      ),
    );
  }
}

class _Blocked extends StatelessWidget {
  const _Blocked({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sahadiesel Job Manage'), actions: const [_LogoutButton()]),
      body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(message, textAlign: TextAlign.center))),
    );
  }
}

class _LogoutButton extends StatelessWidget {
  const _LogoutButton();

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'ออกจากระบบ',
      onPressed: () => FirebaseAuth.instance.signOut(),
      icon: const Icon(Icons.logout),
    );
  }
}
