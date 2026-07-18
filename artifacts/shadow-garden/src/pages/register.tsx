import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useRegisterAccount } from "@workspace/api-client-react/src/generated/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function Register() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const registerMutation = useRegisterAccount({
    mutation: {
      onSuccess: (data) => {
        if (data.success && data.token) {
          login(data.token, data.user);
          toast({
            title: "Welcome to Requiem Order 反逆",
            description: "Your account is ready. The rebellion awaits.",
          });
          setLocation("/profile");
        }
      },
      onError: (error: any) => {
        const data = error?.data as any;
        if (data?.loginRedirect) {
          toast({
            title: "Already Registered",
            description: "This number already has an account. Redirecting to login...",
          });
          setTimeout(() => setLocation("/login"), 1500);
          return;
        }
        toast({
          title: "Registration Failed",
          description: error.message || "Something went wrong. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !name || !password) return;
    if (password.length < 6) {
      toast({ title: "Password too short", description: "Use at least 6 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please re-enter your password.", variant: "destructive" });
      return;
    }
    registerMutation.mutate({ data: { phone, name, password } });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(160,0,26,0.08),transparent)]" />
        <div className="absolute inset-0 bg-black/50" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <p className="text-primary/40 font-mono tracking-[0.5em] text-sm uppercase mb-2">反逆</p>
          <h1 className="font-serif text-4xl font-bold bg-gradient-to-br from-rose-300 via-primary to-amber-300 bg-clip-text text-transparent neon-text-sky tracking-widest uppercase mb-2">
            REQUIEM ORDER
          </h1>
          <p className="text-muted-foreground tracking-[0.3em] uppercase text-xs">New Member Registration</p>
        </div>

        <Card className="glass-card border-primary/20 bg-black/40">
          <CardHeader>
            <CardTitle className="font-serif text-2xl text-center text-white">Create Your Account</CardTitle>
            <CardDescription className="text-center">
              Enter your WhatsApp number, choose a display name, and set a password.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleRegister} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-primary tracking-[0.2em] uppercase text-xs">Display Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Lelouch"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-black/50 border-primary/30 text-white placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:border-primary"
                  required
                  maxLength={32}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-primary tracking-[0.2em] uppercase text-xs">WhatsApp Number</Label>
                <PhoneInput id="phone" value={phone} onChange={setPhone} />
                <p className="text-xs text-muted-foreground">
                  Select your country, then enter your number without the leading 0.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-primary tracking-[0.2em] uppercase text-xs">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-black/50 border-primary/30 text-white placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:border-primary"
                  required
                  minLength={6}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-primary tracking-[0.2em] uppercase text-xs">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-black/50 border-primary/30 text-white placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:border-primary"
                  required
                  minLength={6}
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/80 text-white font-bold tracking-[0.2em] uppercase h-12 neon-border-sky"
                disabled={!phone || !name || !password || !confirmPassword || registerMutation.isPending}
              >
                {registerMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  "Create Account"
                )}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="justify-center border-t border-primary/10 pt-6">
            <p className="text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
