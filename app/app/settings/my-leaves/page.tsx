"use client";

import { useState, useMemo, useEffect, useRef } from 'react';
import Image from "next/image";
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from "zod";
import { addDoc, collection, query, where, orderBy, serverTimestamp, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { format as dfFormat, differenceInCalendarDays, getYear, isBefore, parseISO } from 'date-fns';

import { useFirebase, useCollection, useDoc } from '@/firebase';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import type { LeaveStatus } from '@/lib/constants';
import type { LeaveRequest, HRSettings } from '@/lib/types';
import { leaveTypeLabel, leaveStatusLabel } from '@/lib/ui-labels';
import { compressImageIfNeeded } from "@/lib/image-compress";

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Loader2, Send, Trash2, AlertCircle, ExternalLink, CalendarDays, Camera, ImageIcon, X, Paperclip } from 'lucide-react';
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from "@/components/ui/calendar";
import { cn } from '@/lib/utils';

/** พนักงานยื่นได้เฉพาะลาป่วย / ลากิจ (ไม่มีลาพักร้อน) */
const EMPLOYEE_LEAVE_TYPES = ["SICK", "BUSINESS"] as const;

const MAX_LEAVE_ATTACHMENTS = 2;

const leaveRequestSchema = z.object({
  leaveType: z.enum(EMPLOYEE_LEAVE_TYPES, { required_error: 'กรุณาเลือกประเภทการลา' }),
  startDate: z.string().min(1, 'กรุณาเลือกวันเริ่มลา'),
  endDate: z.string().min(1, 'กรุณาเลือกวันสิ้นสุด'),
  reason: z.string().min(1, 'กรุณาระบุเหตุผลการลา'),
  isHalfDay: z.boolean().default(false),
  halfDaySession: z.enum(['MORNING', 'AFTERNOON']).optional(),
}).refine(data => {
    if (data.startDate && data.endDate) {
        return !isBefore(new Date(data.endDate), new Date(data.startDate));
    }
    return true;
}, {
    message: 'วันที่สิ้นสุดต้องไม่มาก่อนวันเริ่มลา',
    path: ['endDate'],
});

type LeaveFormData = z.infer<typeof leaveRequestSchema>;

export default function MyLeavesPage() {
  const { db, storage } = useFirebase();
  const { profile } = useAuth();
  const { toast } = useToast();
  
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingLeaveData, setPendingLeaveData] = useState<LeaveFormData | null>(null);
  const [pendingLeaveFiles, setPendingLeaveFiles] = useState<File[]>([]);
  const [isOverLimitConfirmOpen, setIsOverLimitConfirmOpen] = useState(false);
  const [indexCreationUrl, setIndexCreationUrl] = useState<string | null>(null);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<string[]>([]);
  const [isCompressingAttachments, setIsCompressingAttachments] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const employeeLeaveTypes = [...EMPLOYEE_LEAVE_TYPES];

  const form = useForm<LeaveFormData>({
    resolver: zodResolver(leaveRequestSchema),
    defaultValues: {
      leaveType: "SICK",
      startDate: "",
      endDate: "",
      reason: '',
      isHalfDay: false,
      halfDaySession: 'MORNING',
    },
  });

  const clearLocalAttachments = () => {
    setAttachmentPreviews((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
    setAttachmentFiles([]);
  };

  useEffect(() => {
    const todayStr = dfFormat(new Date(), 'yyyy-MM-dd');
    form.reset({
      leaveType: "SICK",
      startDate: todayStr,
      endDate: todayStr,
      reason: '',
      isHalfDay: false,
      halfDaySession: 'MORNING',
    });
  }, [form]);
  
  const watchedIsHalfDay = form.watch('isHalfDay');
  const watchedStartDate = form.watch('startDate');

  useEffect(() => {
    if (watchedIsHalfDay && watchedStartDate) {
        form.setValue('endDate', watchedStartDate);
    }
  }, [watchedIsHalfDay, watchedStartDate, form]);

  const settingsDocRef = useMemo(() => db ? doc(db, 'settings', 'hr') : null, [db]);
  const { data: hrSettings, isLoading: isLoadingSettings } = useDoc<HRSettings>(settingsDocRef);

  const userId = profile?.uid;

  const leavesQuery = useMemo(() => {
    if (!db || !userId) return null;
    return query(
      collection(db, 'hrLeaves'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
  }, [db, userId]);

  const { data: myLeaves, isLoading: leavesLoading, error } = useCollection<LeaveRequest>(leavesQuery);

  useEffect(() => {
    if (error?.message?.includes('requires an index')) {
        const urlMatch = error.message.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
            setIndexCreationUrl(urlMatch[0]);
        }
    } else {
        setIndexCreationUrl(null);
    }
  }, [error]);

  const handleAttachmentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const picked = Array.from(e.target.files);
    if (attachmentFiles.length + picked.length > MAX_LEAVE_ATTACHMENTS) {
      toast({
        variant: "destructive",
        title: `แนบได้สูงสุด ${MAX_LEAVE_ATTACHMENTS} รูป`,
        description: "กรุณาเลือกใหม่หรือลบรูปเดิมก่อน",
      });
      e.target.value = "";
      return;
    }
    setIsCompressingAttachments(true);
    try {
      const processed: File[] = [];
      for (const file of picked) {
        processed.push(await compressImageIfNeeded(file));
      }
      setAttachmentFiles((prev) => [...prev, ...processed]);
      setAttachmentPreviews((prev) => [...prev, ...processed.map((f) => URL.createObjectURL(f))]);
    } catch {
      toast({ variant: "destructive", title: "จัดการรูปไม่สำเร็จ" });
    } finally {
      setIsCompressingAttachments(false);
      e.target.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setAttachmentPreviews((prev) => {
      const url = prev[index];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, i) => i !== index);
    });
    setAttachmentFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const submitToFirestore = async (data: LeaveFormData, files: File[]) => {
    if (!db || !profile || !data.startDate) return;
    if (files.length > 0 && !storage) {
      toast({ variant: "destructive", title: "ไม่สามารถอัปโหลดเอกสารได้", description: "ระบบจัดเก็บไฟล์ยังไม่พร้อมใช้งาน" });
      return;
    }
    setIsSubmitting(true);

    const { leaveType, startDate, endDate, reason, isHalfDay, halfDaySession } = data;
    let days = differenceInCalendarDays(new Date(endDate), new Date(startDate)) + 1;
    if (isHalfDay) days = 0.5;

    try {
      const docRef = await addDoc(collection(db, "hrLeaves"), {
        userId: profile.uid,
        userName: profile.displayName,
        leaveType,
        startDate,
        endDate,
        days,
        reason,
        status: "SUBMITTED",
        isHalfDay,
        halfDaySession: isHalfDay ? halfDaySession : null,
        year: getYear(parseISO(startDate)),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (files.length > 0 && storage) {
        try {
          const urls: string[] = [];
          for (let i = 0; i < files.length; i++) {
            const processed = await compressImageIfNeeded(files[i]);
            const photoRef = ref(
              storage,
              `hrLeaveAttachments/${profile.uid}/${docRef.id}/${Date.now()}_${i}.jpg`
            );
            await uploadBytes(photoRef, processed);
            urls.push(await getDownloadURL(photoRef));
          }
          await updateDoc(docRef, {
            attachmentUrls: urls,
            updatedAt: serverTimestamp(),
          });
        } catch (uploadErr: any) {
          await deleteDoc(docRef);
          throw uploadErr;
        }
      }

      toast({ title: "ส่งใบลาสำเร็จ", description: "คำขอของคุณถูกส่งไปรอการพิจารณาแล้ว" });
      clearLocalAttachments();
      form.reset({
        leaveType: "SICK",
        reason: "",
        startDate: dfFormat(new Date(), "yyyy-MM-dd"),
        endDate: dfFormat(new Date(), "yyyy-MM-dd"),
        isHalfDay: false,
        halfDaySession: "MORNING",
      });
    } catch (error: any) {
      toast({ variant: "destructive", title: "ส่งใบลาไม่สำเร็จ", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmit = async (data: LeaveFormData) => {
    const files = [...attachmentFiles];
    if (!hrSettings || !myLeaves || !data.startDate) {
      await submitToFirestore(data, files);
      return;
    }

    const approvedLeavesThisYear = myLeaves.filter(l => l.year === getYear(parseISO(data.startDate)) && l.leaveType === data.leaveType && l.status === 'APPROVED');
    const daysTaken = approvedLeavesThisYear.reduce((sum, l) => sum + l.days, 0);
    const policy = hrSettings.leavePolicy?.leaveTypes?.[data.leaveType];
    const entitlement = policy?.annualEntitlement ?? 0;
    
    let daysInRequest = differenceInCalendarDays(new Date(data.endDate), new Date(data.startDate)) + 1;
    if (data.isHalfDay) daysInRequest = 0.5;

    if (entitlement > 0 && (daysTaken + daysInRequest) > entitlement) {
      setPendingLeaveData(data);
      setPendingLeaveFiles(files);
      setIsOverLimitConfirmOpen(true);
    } else {
      await submitToFirestore(data, files);
    }
  };

  const handleConfirmOverLimit = async () => {
    if (pendingLeaveData) {
      await submitToFirestore(pendingLeaveData, pendingLeaveFiles);
      setPendingLeaveData(null);
      setPendingLeaveFiles([]);
      setIsOverLimitConfirmOpen(false);
    }
  };
  
  async function handleCancel(leaveId: string) {
    if (!db) return;
    setCancellingId(leaveId);
    try {
      const leaveRef = doc(db, 'hrLeaves', leaveId);
      await updateDoc(leaveRef, {
        status: 'CANCELLED',
        updatedAt: serverTimestamp()
      });
      toast({ title: "ยกเลิกคำขอลาเรียบร้อย" });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'ไม่สามารถยกเลิกได้', description: error.message });
    } finally {
      setCancellingId(null);
    }
  }
  
  const getStatusVariant = (status: LeaveStatus) => {
    switch (status) {
      case 'SUBMITTED': return 'secondary';
      case 'APPROVED': return 'default';
      case 'REJECTED': return 'destructive';
      case 'CANCELLED': return 'outline';
      default: return 'outline';
    }
  }

  const isLoading = leavesLoading || isLoadingSettings;

  const renderHistoryContent = () => {
    if (isLoading) {
      return (
        <TableRow>
          <TableCell colSpan={6} className="h-24 text-center">
            <Loader2 className="mx-auto animate-spin text-muted-foreground" />
          </TableCell>
        </TableRow>
      );
    }

    if (indexCreationUrl) {
      return (
        <TableRow>
          <TableCell colSpan={6} className="text-center p-8">
            <div className="flex flex-col items-center gap-4 bg-muted/50 p-6 rounded-lg border border-dashed">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <h3 className="font-semibold text-lg">ต้องสร้างดัชนี (Index) ก่อน</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                ฐานข้อมูลต้องการดัชนีเพื่อจัดเรียงประวัติการลาของคุณ กรุณากดปุ่มด้านล่างเพื่อสร้าง Index
              </p>
              <Button asChild>
                <a href={indexCreationUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" /> สร้าง Index / Create Index
                </a>
              </Button>
            </div>
          </TableCell>
        </TableRow>
      );
    }

    if (myLeaves && myLeaves.length > 0) {
      return myLeaves.map((leave) => (
        <TableRow key={leave.id}>
          <TableCell className="font-medium">
            {dfFormat(parseISO(leave.startDate), 'dd/MM/yy')} 
            {!leave.isHalfDay && leave.endDate !== leave.startDate && ` - ${dfFormat(parseISO(leave.endDate), 'dd/MM/yy')}`}
            {leave.isHalfDay && <span className="ml-1 text-muted-foreground text-[10px]">({leave.halfDaySession === 'MORNING' ? 'ครึ่งเช้า' : 'ครึ่งบ่าย'})</span>}
          </TableCell>
          <TableCell>{leaveTypeLabel(leave.leaveType)}</TableCell>
          <TableCell className="text-center">{leave.days}</TableCell>
          <TableCell>
            <Badge variant={getStatusVariant(leave.status)}>{leaveStatusLabel(leave.status)}</Badge>
          </TableCell>
          <TableCell className="text-sm">
            {leave.attachmentUrls && leave.attachmentUrls.length > 0 ? (
              <div className="flex flex-col gap-1">
                {leave.attachmentUrls.map((url, i) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-2 hover:underline inline-flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    รูป {i + 1}
                  </a>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
          <TableCell className="text-right">
            {leave.status === 'SUBMITTED' && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" disabled={!!cancellingId} title="ยกเลิกใบลา">
                    {cancellingId === leave.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>ยืนยันการยกเลิกคำขอลา?</AlertDialogTitle>
                    <AlertDialogDescription>
                      คุณต้องการยกเลิกใบลาประเภท {leaveTypeLabel(leave.leaveType)} วันที่ {dfFormat(parseISO(leave.startDate), 'dd/MM/yyyy')} ใช่หรือไม่?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>ปิด</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleCancel(leave.id)} className="bg-destructive hover:bg-destructive/90">
                      ยืนยันยกเลิก
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </TableCell>
        </TableRow>
      ));
    }

    return (
      <TableRow>
        <TableCell colSpan={6} className="h-24 text-center text-muted-foreground italic">
          ยังไม่มีประวัติการลา
        </TableCell>
      </TableRow>
    );
  };

  return (
    <>
      <PageHeader title="ใบลาของฉัน" description="ยื่นใบลาและดูประวัติการลาของคุณ" />
      <div className="grid gap-8 md:grid-cols-3">
        <div className="md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>ยื่นใบลาใหม่</CardTitle>
              <CardDescription>กรอกข้อมูลเพื่อส่งคำขอลาไปยังแผนกบุคคล</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="leaveType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ประเภทการลา</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="เลือกประเภทการลา" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {employeeLeaveTypes.map(type => (
                              <SelectItem key={type} value={type}>{leaveTypeLabel(type)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex items-center space-x-2 border p-3 rounded-md bg-muted/20">
                    <FormField control={form.control} name="isHalfDay" render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                            <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <FormLabel className="font-bold cursor-pointer">ลาครึ่งวัน (0.5 วัน)</FormLabel>
                        </FormItem>
                    )} />
                  </div>

                  {watchedIsHalfDay && (
                    <FormField control={form.control} name="halfDaySession" render={({ field }) => (
                        <FormItem>
                            <FormLabel>ช่วงเวลาที่ลา</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                <SelectContent>
                                    <SelectItem value="MORNING">ครึ่งเช้า</SelectItem>
                                    <SelectItem value="AFTERNOON">ครึ่งบ่าย</SelectItem>
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )} />
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="startDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>วันเริ่มลา</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "w-full pl-3 text-left font-normal h-10",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {field.value ? dfFormat(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                                  <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value ? parseISO(field.value) : undefined}
                                onSelect={(date) => field.onChange(date ? dfFormat(date, "yyyy-MM-dd") : "")}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="endDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>วันสิ้นสุด</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "w-full pl-3 text-left font-normal h-10",
                                    !field.value && "text-muted-foreground"
                                  )}
                                  disabled={watchedIsHalfDay}
                                >
                                  {field.value ? dfFormat(parseISO(field.value), "dd/MM/yyyy") : <span>เลือกวันที่</span>}
                                  <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value ? parseISO(field.value) : undefined}
                                onSelect={(date) => field.onChange(date ? dfFormat(date, "yyyy-MM-dd") : "")}
                                disabled={(date) => isBefore(date, parseISO(watchedStartDate))}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                   <FormField
                    control={form.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>เหตุผลการลา</FormLabel>
                        <FormControl>
                          <Textarea placeholder="ระบุเหตุผล เช่น ลาป่วยมีใบรับรองแพทย์..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-3 rounded-lg border border-dashed border-primary/25 bg-muted/20 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Paperclip className="h-4 w-4 text-primary" />
                      แนบเอกสารการลา
                    </div>
                    <p className="text-xs text-muted-foreground">
                      ถ่ายรูปหรือเลือกจากอัลบั้ม (สูงสุด {MAX_LEAVE_ATTACHMENTS} รูป) ระบบจะลดขนาดอัตโนมัติหากใหญ่กว่า ~500 KB
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-24 flex-col gap-2 border-2 border-dashed"
                        disabled={
                          attachmentFiles.length >= MAX_LEAVE_ATTACHMENTS ||
                          isSubmitting ||
                          isCompressingAttachments
                        }
                        onClick={() => cameraInputRef.current?.click()}
                      >
                        {isCompressingAttachments ? (
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        ) : (
                          <Camera className="h-8 w-8 text-primary" />
                        )}
                        <span className="text-xs font-bold uppercase tracking-wide">
                          {isCompressingAttachments ? "กำลังประมวลผล..." : "ถ่ายรูป"}
                        </span>
                        <input
                          type="file"
                          ref={cameraInputRef}
                          className="hidden"
                          accept="image/*"
                          capture="environment"
                          onChange={handleAttachmentChange}
                        />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-24 flex-col gap-2 border-2 border-dashed"
                        disabled={
                          attachmentFiles.length >= MAX_LEAVE_ATTACHMENTS ||
                          isSubmitting ||
                          isCompressingAttachments
                        }
                        onClick={() => galleryInputRef.current?.click()}
                      >
                        <ImageIcon className="h-8 w-8 text-primary" />
                        <span className="text-xs font-bold uppercase tracking-wide">อัลบั้ม</span>
                        <input
                          type="file"
                          ref={galleryInputRef}
                          className="hidden"
                          multiple
                          accept="image/*"
                          onChange={handleAttachmentChange}
                        />
                      </Button>
                    </div>
                    {attachmentPreviews.length > 0 && (
                      <div className="grid grid-cols-2 gap-3">
                        {attachmentPreviews.map((src, index) => (
                          <div key={src} className="relative aspect-square rounded-md border bg-background overflow-hidden">
                            <Image src={src} alt="" fill className="object-cover" unoptimized />
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              className="absolute right-1 top-1 h-7 w-7 rounded-full shadow-md"
                              disabled={isSubmitting}
                              onClick={() => removeAttachment(index)}
                              title="ลบรูปนี้ (ก่อนส่งเท่านั้น)"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isSubmitting || isLoading || isCompressingAttachments}
                  >
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4"/>}
                    ส่งคำขอลา
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
        <div className="md:col-span-2">
            <Card>
                <CardHeader>
                    <CardTitle>ประวัติการลาของฉัน</CardTitle>
                    <CardDescription>รายการใบลาที่ยื่นในระบบทั้งหมด (เรียงตามล่าสุด)</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>วันที่ลา</TableHead>
                                <TableHead>ประเภท</TableHead>
                                <TableHead className="text-center">วัน</TableHead>
                                <TableHead>สถานะ</TableHead>
                                <TableHead>เอกสารแนบ</TableHead>
                                <TableHead className="text-right">จัดการ</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {renderHistoryContent()}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
      </div>
       <AlertDialog
        open={isOverLimitConfirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPendingLeaveData(null);
            setPendingLeaveFiles([]);
          }
          setIsOverLimitConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>จำนวนวันลาของคุณเกินสิทธิ์ที่กำหนด</AlertDialogTitle>
            <AlertDialogDescription>
              การลาครั้งนี้จะทำให้วันลาสะสมเกินจำนวนวันที่บริษัทกำหนด คุณต้องการยืนยันการส่งใบลาต่อหรือไม่?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setPendingLeaveData(null);
                setPendingLeaveFiles([]);
              }}
            >
              ยกเลิก
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmOverLimit} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "ยืนยันส่งใบลา"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
