"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { collection, query, orderBy, addDoc, serverTimestamp, deleteDoc, doc } from "firebase/firestore";
import { useCollection, useFirebase } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";
import { format, isBefore, startOfToday, parseISO } from 'date-fns';

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2, Trash2, CalendarPlus, ShieldAlert } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from "@/components/ui/calendar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { HRHoliday as HRHolidayType } from "@/lib/types";

const holidaySchema = z.object({
  date: z.date({
    required_error: "A date is required.",
  }),
  name: z.string().min(1, "Holiday name is required."),
});

export default function ManagementHRHolidaysPage() {
  const { db } = useFirebase();
  const { toast } = useToast();
  const { profile } = useAuth();
  const canBackfillHoliday = profile?.role === "ADMIN" || profile?.department === "ACCOUNTING_HR";
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  
  const form = useForm<z.infer<typeof holidaySchema>>({
    resolver: zodResolver(holidaySchema),
    defaultValues: {
      name: "",
      date: undefined
    }
  });

  const holidaysQuery = useMemo(() => {
    if (!db) return null;
    return query(collection(db, 'hrHolidays'), orderBy('date', 'desc'));
  }, [db]);

  const { data: holidays, isLoading: isLoadingHolidays } = useCollection<HRHolidayType>(holidaysQuery);

  async function onSubmit(values: z.infer<typeof holidaySchema>) {
    if (!db) return;

    try {
      await addDoc(collection(db, 'hrHolidays'), {
        date: format(values.date, 'yyyy-MM-dd'),
        name: values.name,
        createdAt: serverTimestamp(),
      });
      toast({ title: 'Holiday Added', description: `${values.name} on ${format(values.date, 'PPP')} has been added.` });
      form.reset({ name: '', date: undefined });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  }

  async function deleteHoliday(holidayId: string) {
    if (!db) return;
    try {
      await deleteDoc(doc(db, 'hrHolidays', holidayId));
      toast({ title: 'Holiday Removed' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  }

  const today = startOfToday();

  return (
    <>
        <PageHeader title="ตั้งค่าวันหยุด" description="จัดการวันหยุดประจำปีของบริษัท" />
        <div className="grid gap-8 md:grid-cols-3">
        <div className="md:col-span-1">
            <Card>
            <CardHeader>
                <CardTitle>Add Holiday</CardTitle>
                <CardDescription>Select a date and enter a name to add a new holiday.</CardDescription>
            </CardHeader>
            <CardContent>
                {canBackfillHoliday && (
                    <Alert variant="destructive" className="mb-4">
                        <ShieldAlert className="h-4 w-4" />
                        <AlertTitle>Admin Backfill Mode</AlertTitle>
                        <AlertDescription>
                            You can add/delete holidays in the past.
                        </AlertDescription>
                    </Alert>
                )}
                <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                        <FormItem className="flex flex-col">
                        <FormLabel>Date</FormLabel>
                        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                            <PopoverTrigger asChild>
                            <FormControl>
                                <Button
                                variant={"outline"}
                                className={cn(
                                    "w-full pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                )}
                                >
                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                <CalendarPlus className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                            </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={(date) => {
                                  if (date) {
                                    field.onChange(date);
                                  }
                                  setIsCalendarOpen(false);
                                }}
                                disabled={(date) => !canBackfillHoliday && isBefore(date, today)}
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
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Holiday Name</FormLabel>
                        <FormControl>
                            <Input placeholder="e.g., New Year's Day" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                    <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Add Holiday
                    </Button>
                </form>
                </Form>
            </CardContent>
            </Card>
        </div>
        <div className="md:col-span-2">
            <Card>
            <CardHeader>
                <CardTitle>Holiday List</CardTitle>
                <CardDescription>Upcoming and past holidays.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoadingHolidays ? (
                    <TableRow>
                        <TableCell colSpan={3} className="h-24 text-center">
                        <Loader2 className="mx-auto animate-spin text-muted-foreground" />
                        </TableCell>
                    </TableRow>
                    ) : holidays && holidays.length > 0 ? (
                    holidays.map((holiday) => {
                        const holidayDate = parseISO(holiday.date);
                        const isPast = isBefore(holidayDate, today);
                        const canDelete = canBackfillHoliday || !isPast;
                        return (
                        <TableRow key={holiday.id} className={cn(isPast && "text-muted-foreground")}>
                            <TableCell className="font-medium">{format(holidayDate, 'dd MMM yyyy')}</TableCell>
                            <TableCell>{holiday.name}</TableCell>
                            <TableCell className="text-right">
                            {!canDelete ? (
                                <TooltipProvider delayDuration={100}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span tabIndex={0}>
                                                <Button variant="ghost" size="icon" disabled className="cursor-not-allowed">
                                                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                                                </Button>
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>ไม่สามารถลบวันหยุดที่ผ่านมาแล้ว (เฉพาะ Admin)</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            ) : (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                    >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                        This will permanently delete the holiday: <span className="font-semibold">{holiday.name}</span> on {format(holidayDate, 'PPP')}.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => deleteHoliday(holiday.id)} className="bg-destructive hover:bg-destructive/90">
                                        Delete
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                            </TableCell>
                        </TableRow>
                        );
                    })
                    ) : (
                    <TableRow>
                        <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                        No holidays added yet.
                        </TableCell>
                    </TableRow>
                    )}
                </TableBody>
                </Table>
            </CardContent>
            </Card>
        </div>
        </div>
    </>
  );
}
