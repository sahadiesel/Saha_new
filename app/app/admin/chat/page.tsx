"use client";

import { useState, useRef, useEffect } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, query, getDocs, limit, orderBy } from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Bot, Send, Loader2, Sparkles, User, 
  ShieldAlert, Heart, Database, Info 
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
}

export default function AdminChatPage() {
  const { db, app: firebaseApp } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'model',
      content: `สวัสดีค่ะพี่โจ้! น้องจิมมี่พร้อมช่วยพี่โจ้ดูแลร้านสหดีเซลแบบเต็มตัวแล้วค่ะ ตอนนี้น้องจิมมี่สามารถประมวลผลข้อมูลบัญชีและงานซ่อมที่พี่ดึงมาให้ดูได้แล้วนะคะ พี่โจ้อยากรู้อะไรพิมพ์ถามน้องจิมมี่ได้เลยนะคะ!`,
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isAllowed = profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.department === 'MANAGEMENT';

  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [messages, isLoading]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading || !db || !firebaseApp) return;

    const userMsg = inputValue.trim();
    setInputValue("");
    setMessages(prev => [...prev, { role: 'user', content: userMsg, timestamp: new Date() }]);
    setIsLoading(true);

    try {
      // 1. Fetch Context from Client-side
      const [jobsSnap, entriesSnap] = await Promise.all([
        getDocs(query(collection(db, "jobs"), limit(50))),
        getDocs(query(collection(db, "accountingEntries"), orderBy("entryDate", "desc"), limit(30)))
      ]);

      const businessSummary = {
        activeJobs: jobsSnap.docs.filter(d => d.data().status !== 'CLOSED').map(d => ({
            id: d.id, customer: d.data().customerSnapshot?.name, status: d.data().status, dept: d.data().department
        })),
        recentTransactions: entriesSnap.docs.map(d => ({
            date: d.data().entryDate, amount: d.data().amount, type: d.data().entryType, desc: d.data().description
        }))
      };

      // 2. Call Jimmy AI via Cloud Function
      const functions = getFunctions(firebaseApp, 'us-central1');
      const chatWithJimmy = httpsCallable(functions, 'chatWithJimmy');
      
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const result = await chatWithJimmy({ 
        message: userMsg, 
        scope: 'MANAGEMENT',
        history,
        contextData: { businessSummary }
      });
      
      const data = result.data as any;
      setMessages(prev => [...prev, { 
        role: 'model', 
        content: data?.answer || "ขอโทษทีค่ะพี่ จิมมี่ประมวลผลขัดข้อง รบกวนลองอีกรอบนะคะ", 
        timestamp: new Date() 
      }]);
    } catch (error: any) {
      console.error("Chat Error:", error);
      const errorDetail = error.message || "Unknown Error";
      
      toast({ 
        variant: "destructive", 
        title: "จิมมี่ขัดข้อง", 
        description: errorDetail === 'internal' ? "เซิร์ฟเวอร์ขัดข้อง (CORS/Auth) กรุณาลองใหม่อีกครั้งค่ะ" : errorDetail 
      });

      setMessages(prev => [...prev, { 
        role: 'model', 
        content: `ขอโทษทีค่ะพี่ ระบบจิมมี่ขัดข้อง: ${errorDetail}\n\nหากพี่ใช้ Chrome รบกวนตรวจสอบว่าได้กด "Publish" หรือลองรีเฟรชหน้าจอใหม่อีกครั้งนะคะ หรือตรวจสอบ Gemini API Key ในหน้าตั้งค่า AI ค่ะ`, 
        timestamp: new Date() 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAllowed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="h-16 w-16 text-destructive" />
        <Card className="max-w-md text-center">
          <CardHeader>
            <CardTitle>ไม่มีสิทธิ์เข้าถึง</CardTitle>
            <CardDescription>หน้านี้สงวนไว้สำหรับผู้บริหารเท่านั้นค่ะ</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Chat with Nong Jimmy" 
        description="ปรึกษาน้องจิมมี่ ผู้ช่วยส่วนตัวคนเก่งเพื่อการบริหารจัดการร้านสหดีเซล" 
      >
        <div className="flex items-center gap-2 px-4 py-2 bg-pink-500/10 rounded-full border border-pink-500/20 shadow-sm">
            <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-pink-500"></span>
            </span>
            <span className="text-xs font-bold text-pink-600 flex items-center gap-1 uppercase tracking-widest">
              Jimmy is Online <Heart className="h-3 w-3 fill-pink-600" />
            </span>
        </div>
      </PageHeader>
      
      <div className="flex flex-col h-[calc(100vh-15rem)] max-w-5xl mx-auto border rounded-xl overflow-hidden bg-background shadow-2xl border-primary/20">
        <div className="bg-primary p-4 flex items-center justify-between text-primary-foreground shadow-lg">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-full ring-2 ring-white/30"><Bot className="h-6 w-6" /></div>
            <div>
              <h3 className="font-bold text-lg leading-none flex items-center gap-2">น้องจิมมี่ <Badge variant="secondary" className="bg-pink-500/80 text-white text-[10px] h-4">Manager Assistant</Badge></h3>
              <p className="text-xs text-primary-foreground/70 mt-1">ผู้ช่วยคนเก่งประจำโต๊ะทำงานพี่โจ้</p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] border-white/40 text-white bg-white/10">SYSTEM AI CONNECTED</Badge>
        </div>

        <ScrollArea className="flex-1 p-4 bg-muted/5" ref={scrollRef}>
          <div className="space-y-6 pb-4 max-w-4xl mx-auto">
            {messages.map((m, i) => (
              <div key={i} className={cn("flex w-full gap-3", m.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                <Avatar className={cn("h-9 w-9 shrink-0", m.role === 'model' ? "ring-2 ring-primary/20" : "ring-2 ring-muted")}>
                  {m.role === 'model' ? <div className="bg-primary flex items-center justify-center w-full h-full text-white"><Bot className="h-5 w-5" /></div> : <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${profile?.displayName}`} />}
                  <AvatarFallback>JM</AvatarFallback>
                </Avatar>
                <div className={cn("max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm transition-all border", m.role === 'user' ? "bg-primary text-primary-foreground border-primary rounded-tr-none" : "bg-white border-border rounded-tl-none prose prose-sm dark:prose-invert")}>
                  <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  <div className={cn("text-[10px] mt-2 opacity-50 font-medium", m.role === 'user' ? "text-right" : "text-left")}>{format(m.timestamp, 'HH:mm')}</div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex w-full gap-3">
                <div className="h-9 w-9 rounded-full bg-primary flex items-center justify-center text-white shrink-0"><Bot className="h-5 w-5 animate-bounce" /></div>
                <div className="bg-white border border-border rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-2 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground italic font-medium">น้องจิมมี่กำลังวิเคราะห์ข้อมูลหลังบ้านให้พี่โจ้อยู่นะคะ...</span>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 bg-background border-t shadow-inner">
          <div className="flex gap-2 max-w-4xl mx-auto items-center">
            <Input 
              placeholder="พิมพ์ถามน้องจิมมี่เรื่องบริหารร้านได้เลยค่ะ..." 
              className="rounded-full bg-muted/30 border-primary/20 h-12 px-6 focus-visible:ring-primary shadow-inner" 
              value={inputValue} 
              onChange={(e) => setInputValue(e.target.value)} 
              onKeyDown={(e) => e.key === 'Enter' && handleSend()} 
              disabled={isLoading} 
            />
            <Button size="icon" className="rounded-full h-12 w-12 shrink-0 shadow-lg transition-transform hover:scale-105" onClick={handleSend} disabled={!inputValue.trim() || isLoading}>
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}