
"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ChevronDown, Menu, User, Briefcase, Globe, Phone, Package, Settings, Home, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

export function PublicHeader() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

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
            <Link href="#contact">ติดต่อเรา</Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="ml-4 border-primary text-primary hover:bg-primary hover:text-white font-bold gap-2 rounded-full">
                ลงชื่อเข้าใช้ <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-slate-800 border-white/10 text-white">
              <DropdownMenuItem asChild className="focus:bg-primary/20 focus:text-white cursor-pointer py-3">
                <Link href="/login">
                  <Briefcase className="mr-2 h-4 w-4 text-primary" /> 
                  สำหรับพนักงาน (Staff)
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem className="focus:bg-primary/20 focus:text-white cursor-pointer py-3">
                <User className="mr-2 h-4 w-4 text-blue-400" /> 
                สำหรับลูกค้า (Customer)
              </DropdownMenuItem>
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

                <Button variant="ghost" asChild className="w-full justify-start text-white hover:bg-white/10 h-12 mt-2" onClick={closeMobileMenu}>
                  <Link href="#contact">
                    <Mail className="mr-3 h-5 w-5 text-primary" />
                    ติดต่อเรา
                  </Link>
                </Button>

                <Accordion type="single" collapsible className="w-full mt-4">
                  <AccordionItem value="login" className="border-none mt-2">
                    <AccordionTrigger className="px-4 h-12 hover:no-underline hover:bg-white/10 rounded-md text-white font-normal">
                      <div className="flex items-center">
                        <User className="mr-3 h-5 w-5 text-primary" />
                        ลงชื่อเข้าใช้
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="bg-white/5 rounded-md mt-1 pb-2 px-2">
                      <Button variant="ghost" asChild className="w-full justify-start pl-12 h-10 text-slate-300" onClick={closeMobileMenu}>
                        <Link href="/login">
                          <Briefcase className="mr-2 h-4 w-4 text-primary" /> สำหรับพนักงาน
                        </Link>
                      </Button>
                      <Button variant="ghost" className="w-full justify-start pl-12 h-10 text-slate-300" onClick={closeMobileMenu}>
                        <User className="mr-2 h-4 w-4 text-blue-400" /> สำหรับลูกค้า
                      </Button>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
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
