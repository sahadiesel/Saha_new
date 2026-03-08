"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronDown, Menu, User, Briefcase, Globe, Phone, Package, Settings, Home, Mail, Wrench, LayoutDashboard, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export function PublicHeader() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, profile, signOut } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  const getInitials = (name?: string) => {
    if (!name) return "U";
    return name.charAt(0).toUpperCase();
  }

  return (
    <header 
      className={cn(
        "fixed top-0 z-50 w-full transition-all duration-300 px-4 md:px-8",
        isScrolled 
          ? "h-16 bg-slate-900/95 backdrop-blur-md border-b border-white/10" 
          : "h-20 bg-transparent"
      )}
    >
      <div className="container mx-auto h-full flex items-center justify-between">
        <Logo className="scale-90" />

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          <Button variant="ghost" asChild className="text-white hover:bg-white/10 hover:text-white font-medium">
            <Link href="/">หน้าแรก</Link>
          </Button>

          <Button variant="ghost" asChild className="text-white hover:bg-white/10 hover:text-white font-medium">
            <Link href="/products">สินค้าและอะไหล่</Link>
          </Button>

          <Button variant="ghost" asChild className="text-white hover:bg-white/10 hover:text-white font-medium">
            <Link href="/services">งานบริการ</Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {user ? (
                <Button variant="outline" className="ml-4 h-10 border-none bg-white hover:bg-white/90 text-slate-900 font-bold gap-2 rounded-full pl-1 pr-4 shadow-lg shadow-black/20">
                  <Avatar className="h-8 w-8 ring-2 ring-primary/20">
                    <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${profile?.displayName}`} />
                    <AvatarFallback className="bg-primary text-white text-[10px]">{getInitials(profile?.displayName)}</AvatarFallback>
                  </Avatar>
                  <span className="max-w-[120px] truncate">{profile?.displayName || user.email}</span>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              ) : (
                <Button variant="outline" className="ml-4 border-primary text-primary hover:bg-primary hover:text-white font-bold gap-2 rounded-full">
                  ลงชื่อเข้าใช้ <ChevronDown className="h-4 w-4" />
                </Button>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-slate-800 border-white/10 text-white shadow-2xl">
              {!user ? (
                <>
                  <DropdownMenuItem asChild className="focus:bg-primary/20 focus:text-white cursor-pointer py-3">
                    <Link href="/login">
                      <Briefcase className="mr-2 h-4 w-4 text-primary" /> 
                      สำหรับพนักงาน (Staff)
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem className="focus:bg-primary/20 focus:text-white cursor-pointer py-3 opacity-50">
                    <User className="mr-2 h-4 w-4 text-blue-400" /> 
                    สำหรับลูกค้า (Customer)
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <div className="px-3 py-2 text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                    เข้าใช้โดย: {profile?.displayName}
                  </div>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem asChild className="focus:bg-primary/20 focus:text-white cursor-pointer py-3 font-bold text-primary">
                    <Link href="/app">
                      <LayoutDashboard className="mr-2 h-4 w-4" /> 
                      หน้าหลักของฉัน
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={signOut} className="focus:bg-destructive/20 focus:text-destructive cursor-pointer py-3 text-destructive font-bold">
                    <LogOut className="mr-2 h-4 w-4" /> 
                    ออกจากระบบ
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        {/* Mobile Navigation */}
        <div className="md:hidden flex items-center">
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
                <Menu className="h-6 w-6" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="bg-slate-900 border-white/10 text-white w-[300px] p-0">
              <SheetHeader className="p-6 border-b border-white/10 text-left">
                <SheetTitle className="text-white font-headline text-xl">เมนูหลัก</SheetTitle>
              </SheetHeader>
              
              <div className="flex flex-col p-4">
                <Button variant="ghost" asChild className="justify-start text-white hover:bg-white/10 mb-2 h-12" onClick={closeMobileMenu}>
                  <Link href="/">
                    <Home className="mr-3 h-5 w-5 text-primary" />
                    หน้าแรก
                  </Link>
                </Button>

                <Button variant="ghost" asChild className="justify-start text-white hover:bg-white/10 mb-2 h-12" onClick={closeMobileMenu}>
                  <Link href="/products">
                    <Package className="mr-3 h-5 w-5 text-primary" />
                    สินค้าและอะไหล่
                  </Link>
                </Button>

                <Button variant="ghost" asChild className="justify-start text-white hover:bg-white/10 mb-2 h-12" onClick={closeMobileMenu}>
                  <Link href="/services">
                    <Wrench className="mr-3 h-5 w-5 text-primary" />
                    งานบริการ
                  </Link>
                </Button>

                <div className="mt-4 pt-4 border-t border-white/10">
                  {!user ? (
                    <div className="space-y-2">
                      <Button variant="outline" asChild className="w-full justify-start border-white/20 bg-white/5 h-12" onClick={closeMobileMenu}>
                        <Link href="/login">
                          <Briefcase className="mr-3 h-5 w-5 text-primary" />
                          ลงชื่อเข้าใช้ (พนักงาน)
                        </Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Button variant="ghost" asChild className="justify-start text-primary h-12 font-bold" onClick={closeMobileMenu}>
                        <Link href="/app">
                          <LayoutDashboard className="mr-3 h-5 w-5" />
                          หน้าหลักของฉัน
                        </Link>
                      </Button>
                      <Button variant="ghost" onClick={() => { signOut(); closeMobileMenu(); }} className="w-full justify-start text-destructive h-12 font-bold">
                        <LogOut className="mr-3 h-5 w-5" />
                        ออกจากระบบ
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="absolute bottom-8 left-0 right-0 px-6 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">Sahadiesel Service System</p>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
