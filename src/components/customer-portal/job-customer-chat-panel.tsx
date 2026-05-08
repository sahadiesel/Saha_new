"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  type FirestoreError,
} from "firebase/firestore";
import { useFirebase } from "@/firebase";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import type { JobCustomerChatMessage, UserProfile } from "@/lib/types";
import {
  callPostJobCustomerChatMessage,
  formatJobCustomerChatCallableError,
} from "@/lib/callable-job-customer-chat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, MessageCircle } from "lucide-react";
import { format } from "date-fns";
import { th } from "date-fns/locale/th";
import { cn } from "@/lib/utils";

/** กันค่า displayName/email ในฐานข้อมูลไม่ใช่ string (ข้อมูลเก่า) — ใช้ตอนส่งแชตฝั่งพนักงาน (addDoc) */
function portalChatSenderLabel(profile: UserProfile): string {
  const n = profile.displayName as unknown;
  const em = profile.email as unknown;
  if (typeof n === "string" && n.trim()) return n.trim().slice(0, 200);
  if (typeof em === "string" && em.trim()) return em.trim().slice(0, 200);
  return "ผู้ใช้";
}

interface JobCustomerChatPanelProps {
  jobId: string;
  variant: "customer" | "staff";
  /** ไม่ subscribe เลย (เช่น งานในอาร์ไคฟ์บนพอร์ทัลลูกค้า) */
  disabled?: boolean;
  /** โหลดข้อความได้ แต่ซ่อนช่องส่ง (พนักงานโหมดดูอย่างเดียว / งานอาร์ไคฟ์) */
  readOnly?: boolean;
}

export function JobCustomerChatPanel({ jobId, variant, disabled, readOnly }: JobCustomerChatPanelProps) {
  const { db, app } = useFirebase();
  const { profile, user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<JobCustomerChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const authorRole = variant === "customer" ? "CUSTOMER" : "STAFF";

  const chatQuery = useMemo(() => {
    if (!db || !jobId) return null;
    return query(collection(db, "jobs", jobId, "customerChat"), orderBy("createdAt", "asc"));
  }, [db, jobId]);

  useEffect(() => {
    if (!chatQuery || disabled) {
      setLoading(false);
      setMessages([]);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      chatQuery,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as JobCustomerChatMessage));
        setMessages(rows);
        setLoading(false);
      },
      (err: FirestoreError) => {
        console.error("customerChat", err);
        toast({
          variant: "destructive",
          title: "โหลดแชตไม่สำเร็จ",
          description: err.message,
        });
        setLoading(false);
      }
    );
    return () => unsub();
  }, [chatQuery, disabled, toast]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!db || !profile || !user || disabled) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      if (authorRole === "CUSTOMER") {
        if (!app) throw new Error("ไม่พร้อมเชื่อมต่อระบบ");
        await callPostJobCustomerChatMessage(app, jobId, trimmed);
      } else {
        await addDoc(collection(db, "jobs", jobId, "customerChat"), {
          text: trimmed,
          authorRole,
          userName: portalChatSenderLabel(profile),
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
      }
      setText("");
    } catch (er: unknown) {
      const msg =
        authorRole === "CUSTOMER"
          ? formatJobCustomerChatCallableError(er)
          : er instanceof Error
            ? er.message
            : "ส่งข้อความไม่สำเร็จ";
      toast({ variant: "destructive", title: "ส่งไม่สำเร็จ", description: msg });
    } finally {
      setSending(false);
    }
  }

  const title =
    variant === "customer" ? "Chat with สหดีเซล" : "แชตกับลูกค้า (พอร์ทัล)";
  const description =
    variant === "customer"
      ? "ฝากข้อความถามหรือแจ้งศูนย์ — เจ้าหน้าที่จะตอบในช่องเดียวกัน"
      : "ข้อความจากลูกค้าในพอร์ทัล — ตอบกลับเพื่อแจ้งลูกค้าได้ทันที";

  return (
    <Card
      className={cn(
        variant === "customer" &&
          "border-2 border-blue-600 bg-blue-950/25 text-white shadow-lg shadow-blue-900/20"
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageCircle className={cn("h-5 w-5", variant === "customer" ? "text-blue-400" : "text-primary")} />
          {title}
        </CardTitle>
        <CardDescription className={variant === "customer" ? "text-blue-100/80" : undefined}>
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ScrollArea className="h-[220px] rounded-md border border-white/10 bg-black/20 p-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">ยังไม่มีข้อความ</p>
          ) : (
            <div className="space-y-3 pr-2">
              {messages.map((m) => {
                const mine =
                  (variant === "customer" && m.authorRole === "CUSTOMER") ||
                  (variant === "staff" && m.authorRole === "STAFF");
                const ts = m.createdAt?.toDate?.();
                return (
                  <div
                    key={m.id || `${m.userId}-${ts?.getTime?.()}`}
                    className={cn("flex", mine ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm",
                        m.authorRole === "CUSTOMER"
                          ? "bg-blue-700/90 text-white"
                          : "bg-slate-700 text-slate-50 border border-white/10"
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.text}</p>
                      <p className={cn("mt-1 text-[10px] opacity-80", mine ? "text-right" : "text-left")}>
                        {m.userName}
                        {ts ? ` · ${format(ts, "d MMM yyyy HH:mm", { locale: th })}` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {!readOnly ? (
          <form onSubmit={handleSend} className="flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={variant === "customer" ? "พิมพ์ข้อความถึงศูนย์..." : "พิมพ์ข้อความตอบลูกค้า..."}
              disabled={disabled || sending || !profile}
              maxLength={3500}
              className={variant === "customer" ? "bg-slate-950/50 border-blue-500/40" : undefined}
            />
            <Button type="submit" disabled={disabled || sending || !text.trim() || !profile}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-1">โหมดดูอย่างเดียว — ไม่สามารถส่งข้อความในช่องนี้</p>
        )}
      </CardContent>
    </Card>
  );
}
