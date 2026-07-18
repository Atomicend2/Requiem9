import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useLogin, useSendOtp, useVerifyOtp } from "@workspace/api-client-react/src/generated/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type Mode = "login" | "forgot-request" | "forgot-reset";

export default function Login() {
  const [mode, setMode] = useState<Mode>("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        if (data.success && data.token) {
          login(data.token, data.user);
          toast({
            title: "Welcome to Requiem Order",
            description: "Welcome back. The rebellion awaits.",
          });
          setLocation("/profile");
        }
      },
      onError: (error: any) => {
        const data = error?.data as any;
        if (data?.registerRedirect) {
          toast({
            title: "Not Registered",
            description: "This number isn't in our system. Redirecting to registration...",
            variant: "destructive",
          });
          setTimeout(() => setLocation("/register"), 1500);
          return;
        }
        toast({
          title: "Login Failed",
          description: error.message || "Incorrect phone number or password.",
          variant: "destructive",
        });
      },
    },
  });

  const sendOtpMutation = useSendOtp({
    mutation: {
      onSuccess: () => {
        setMode("forgot-reset");
        toast({
          title: "Code Sent",
          description: "Check your WhatsApp for the password-reset code.",
        });
      },
      onError: (error: any) => {
        const data = error?.data as any;
        if (data?.registerRedirect) {
          toast({
            title: "Not Registered",
            description: "This number isn't in our system. Redirecting to registration...",
            variant: "destructive",
          });
          setTimeout(() => setLocation("/register"), 1500);
          return;
        }
        toast({
          title: "Error",
          description: error.message || "Failed to send code. Please try again.",
          variant: "destructive",
        });
      },
    }
  });

  const verifyOtpMutation = useVerifyOtp({
    mutation: {
      onSuccess: (data) => {
        if (data.success && data.token) {
          login(data.token, data.user);
          toast({
            title: "Password Updated",
            description: "You're signed in with your new password.",
          });
          setLocation("/profile");
        }
      },
      onError: (error) => {
        toast({
          title: "Invalid Code",
          description: error.message || "The code you entered is incorrect or expired.",
          variant: "destructive",
        });
      }
    }
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !password) return;
    loginMutation.mutate({ data: { phone, password } });
  };

  const handleSendResetOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    sendOtpMutation.mutate({ data: { phone } });
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !newPassword) return;
    if (newPassword.length < 6) {
      toast({ title: "Password too short", description: "Use at least 6 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast({ title: "Passwords don't match", description: "Please re-enter your new password.", variant: "destructive" });
      return;
    }
    verifyOtpMutation.mutate({ data: { phone, code, newPassword } });
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
          <p className="text-muted-foreground tracking-[0.3em] uppercase text-xs">Authentication Protocol</p>
        </div>

        <Card className="glass-card border-primary/20 bg-black/40">
          <CardHeader>
            <CardTitle className="font-serif text-2xl text-center text-white">
              {mode === "login" && "Identify Yourself"}
              {mode === "forgot-request" && "Reset Password"}
              {mode === "forgot-reset" && "Set New Password"}
            </CardTitle>
            <CardDescription className="text-center">
              {mode === "login" && "Enter your registered WhatsApp number and password."}
              {mode === "forgot-request" && "Enter your WhatsApp number to receive a reset code."}
              {mode === "forgot-reset" && "Enter the 6-digit code and choose a new password."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mode === "login" && (
              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-primary tracking-[0.2em] uppercase text-xs">WhatsApp Number</Label>
                  <PhoneInput id="phone" value={phone} onChange={setPhone} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-primary tracking-[0.2em] uppercase text-xs">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-black/50 border-primary/30 text-white placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:border-primary"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/80 text-white font-bold tracking-[0.2em] uppercase h-12 neon-border-sky"
                  disabled={!phone || !password || loginMutation.isPending}
                >
                  {loginMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Enlist"}
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setMode("forgot-request")}
                  >
                    Forgot password?
                  </button>
                </p>
              </form>
            )}

            {mode === "forgot-request" && (
              <form onSubmit={handleSendResetOtp} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="resetPhone" className="text-primary tracking-[0.2em] uppercase text-xs">WhatsApp Number</Label>
                  <PhoneInput id="resetPhone" value={phone} onChange={setPhone} />
                </div>
                <div className="flex gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 border-primary/30 text-white hover:bg-primary/20"
                    onClick={() => setMode("login")}
                    disabled={sendOtpMutation.isPending}
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    className="flex-[2] bg-primary hover:bg-primary/80 text-white font-bold tracking-[0.2em] uppercase h-12 neon-border-sky"
                    disabled={!phone || sendOtpMutation.isPending}
                  >
                    {sendOtpMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Send Code"}
                  </Button>
                </div>
              </form>
            )}

            {mode === "forgot-reset" && (
              <form onSubmit={handleResetPassword} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="code" className="text-primary tracking-[0.2em] uppercase text-xs">Reset Code</Label>
                  <Input
                    id="code"
                    placeholder="6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="bg-black/50 border-primary/30 text-white text-center tracking-[0.5em] text-lg focus-visible:ring-primary focus-visible:border-primary"
                    maxLength={6}
                    required
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    Sent to <span className="text-primary font-mono">+{phone}</span> via WhatsApp
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-primary tracking-[0.2em] uppercase text-xs">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="At least 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="bg-black/50 border-primary/30 text-white placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:border-primary"
                    required
                    minLength={6}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmNewPassword" className="text-primary tracking-[0.2em] uppercase text-xs">Confirm New Password</Label>
                  <Input
                    id="confirmNewPassword"
                    type="password"
                    placeholder="Re-enter new password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="bg-black/50 border-primary/30 text-white placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:border-primary"
                    required
                    minLength={6}
                  />
                </div>
                <div className="flex gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 border-primary/30 text-white hover:bg-primary/20"
                    onClick={() => setMode("forgot-request")}
                    disabled={verifyOtpMutation.isPending}
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    className="flex-[2] bg-primary hover:bg-primary/80 text-white font-bold tracking-[0.2em] uppercase h-12 neon-border-sky"
                    disabled={!code || !newPassword || !confirmNewPassword || verifyOtpMutation.isPending}
                  >
                    {verifyOtpMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Reset & Sign In"}
                  </Button>
                </div>
                <p className="text-xs text-center text-muted-foreground">
                  Didn't receive it?{" "}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => sendOtpMutation.mutate({ data: { phone } })}
                    disabled={sendOtpMutation.isPending}
                  >
                    Resend code
                  </button>
                </p>
              </form>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-2 items-center border-t border-primary/10 pt-6">
            <p className="text-xs text-muted-foreground">
              New here?{" "}
              <Link href="/register" className="text-primary hover:underline font-semibold">
                Create an account
              </Link>
            </p>
            <p className="text-xs text-muted-foreground">
              Or{" "}
              <a href="https://chat.whatsapp.com/EDDDHxRGNmoEKacTlQQmun" target="_blank" rel="noopener noreferrer" className="text-primary/70 hover:underline">
                join the WhatsApp group
              </a>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
