"use client"

import Link from "next/link"
import { Settings, LogOut, FileText, Receipt, CalendarDays, Home } from "lucide-react"

import { useAuth } from "@/context/auth-context"
import { useAppNavLabel } from "@/context/public-site-language-context"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/logo"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { AppNav } from "@/components/app-nav"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"


export function AppSidebar() {
  const { profile, signOut } = useAuth();
  const { t } = useAppNavLabel();

  const getInitials = (name?: string) => {
    if (!name) return "?";
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  }

  const isOutsourceWorker = profile?.department === 'OUTSOURCE' && profile?.role === 'WORKER';
  
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-background sm:flex print:hidden">
      <div className="flex h-full max-h-screen flex-col">
        <div className="flex h-14 items-center border-b px-4 lg:h-[60px]">
            <Logo />
        </div>
        
        <div className="flex-1 overflow-y-auto py-2">
            <AppNav />
        </div>

        {profile && (
            <div className="mt-auto border-t p-2">
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="w-full justify-start h-auto p-2">
                             <div className="flex items-center gap-3">
                                <Avatar className="h-9 w-9">
                                    <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${profile.displayName}`} />
                                    <AvatarFallback>{getInitials(profile.displayName)}</AvatarFallback>
                                </Avatar>
                                <div className="text-left overflow-hidden">
                                    <p className="text-sm font-medium leading-none truncate">{profile.displayName}</p>
                                    <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
                                </div>
                             </div>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56 mb-2" align="start">
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
            </div>
        )}
      </div>
    </aside>
  )
}
