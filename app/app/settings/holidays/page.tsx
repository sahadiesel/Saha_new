"use client";

import { useState, useMemo } from "react";
import { collection, query, where, orderBy } from "firebase/firestore";
import { getYear, format, parseISO } from 'date-fns';

import { useFirebase, useCollection } from "@/firebase";
import type { HRHoliday } from "@/lib/types";
import type { WithId } from "@/firebase/firestore/use-collection";
import { useAppNavLabel } from "@/context/public-site-language-context";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

// Group holidays by month
const groupHolidaysByMonth = (holidays: WithId<HRHoliday>[]) => {
  return holidays.reduce((acc, holiday) => {
    const month = format(parseISO(holiday.date), 'MMMM yyyy');
    if (!acc[month]) {
      acc[month] = [];
    }
    acc[month].push(holiday);
    return acc;
  }, {} as Record<string, WithId<HRHoliday>[]>);
};

export default function MyHolidaysPage() {
  const { db } = useFirebase();
  const { t } = useAppNavLabel();
  const [selectedYear, setSelectedYear] = useState(getYear(new Date()).toString());

  const holidaysQuery = useMemo(() => {
    if (!db) return null;
    return query(
      collection(db, 'hrHolidays'),
      where('date', '>=', `${selectedYear}-01-01`),
      where('date', '<=', `${selectedYear}-12-31`),
      orderBy('date', 'asc')
    );
  }, [db, selectedYear]);

  const { data: holidays, isLoading: isLoadingHolidays, error } = useCollection<HRHoliday>(holidaysQuery);

  const groupedHolidays = useMemo(() => {
    if (!holidays) return {};
    return groupHolidaysByMonth(holidays);
  }, [holidays]);

  const yearOptions = useMemo(() => {
    const currentYear = getYear(new Date());
    return Array.from({ length: 5 }, (_, i) => (currentYear - 2 + i).toString());
  }, []);

  return (
    <>
      <PageHeader title={t("ปฏิทินวันหยุด")} description={t("วันหยุดตามประเพณีประจำปีของบริษัท")} />
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>{t("วันหยุดปี")} {selectedYear}</CardTitle>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map(year => (
                  <SelectItem key={year} value={year}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingHolidays ? (
            <div className="flex justify-center items-center h-48">
              <Loader2 className="animate-spin h-8 w-8" />
            </div>
          ) : error ? (
            <div className="text-destructive text-center">
              Error loading holidays: {error.message}
            </div>
          ) : Object.keys(groupedHolidays).length > 0 ? (
            <div className="space-y-6">
              {Object.entries(groupedHolidays).map(([month, monthHolidays]) => (
                <div key={month}>
                  <h3 className="text-lg font-semibold mb-2">{month}</h3>
                  <ul className="space-y-2 list-disc pl-5 text-muted-foreground">
                    {monthHolidays.map(holiday => (
                      <li key={holiday.id}>
                        <span className="font-medium text-foreground">{format(parseISO(holiday.date), 'dd')}</span>: {t(holiday.name)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground h-48 flex items-center justify-center">
              {t("ไม่มีข้อมูลวันหยุดสำหรับปีที่เลือก")}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
