"use client"

import { useState } from "react"
import Link from "next/link"
import { Menu, Settings, LogOut, FileText, Receipt, CalendarDays, Home } from "lucide-react"

import { useAuth } from "@/context/auth-context"
import { useAppNavLabel } from "@/context/public-site-language-context"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet"
import { Logo } from "@/components/logo"
import { AppNav } from "@/components/app-nav"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"

export function AppHeader() {
  const [open, setOpen] = useState(false);
  const { profile, signOut } = useAuth();
  const { t } = useAppNavLabel();

  const getInitials = (name?: string) => {
    if (!name) return "?";
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  }

  const isOutsourceWorker = profile?.department === 'OUTSOURCE' && profile?.role === 'WORKER';

  return (
    <header className="sm:hidden flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6 sticky top-0 z-30 print:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="shrink-0">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle navigation menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="flex flex-col p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation Menu</SheetTitle>
            <SheetDescription>A list of links to navigate the application.</SheetDescription>
          </SheetHeader>
          <div className="flex h-14 items-center border-b px-4">
              <Logo />
          </div>
          <div className="flex-1 overflow-y-auto">
            <AppNav onLinkClick={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="w-full flex-1">
        {/* Can add search or other header elements here */}
      </div>

      {profile && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Avatar className="h-8 w-8">
              <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${profile.displayName}`} />
              <AvatarFallback>{getInitials(profile.displayName)}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{profile.displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings"><Settings className="mr-2 h-4 w-4"/> {t("โปรไฟล์และการตั้งค่า")}</Link>
            </DropdownMenuItem>
            {!isOutsourceWorker && (
                <DropdownMenuItem asChild>
                    <Link href="/settings/my-leaves"><FileText className="mr-2 h-4 w-4"/> {t("ใบลาของฉัน")}</Link>
                </DropdownMenuItem>
            )}
             <DropdownMenuItem asChild>
              <Link href="/settings/holidays"><CalendarDays className="mr-2 h-4 w-4"/> {t("ปฏิทินวันหยุด")}</Link>
            </DropdownMenuItem>
            {!isOutsourceWorker && (
                <DropdownMenuItem asChild>
                    <Link href="/settings/my-payslips"><Receipt className="mr-2 h-4 w-4"/> {t("ใบเงินเดือนของฉัน")}</Link>
                </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
                <Link href="/" className="text-primary font-bold">
                    <Home className="mr-2 h-4 w-4" />
                    <span>{t("กลับสู่หน้าแรก")}</span>
                </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  )
}
