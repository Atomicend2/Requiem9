import { useState, useMemo } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ITU-T E.164 calling codes. Flag emoji derived from ISO 3166-1 alpha-2 via
// regional indicator symbols. This list intentionally covers every country
// with an assigned calling code — trimming it would just mean someone's
// country silently isn't selectable.
interface Country { code: string; dial: string; name: string; }

const COUNTRIES: Country[] = [
  { code: "US", dial: "1", name: "United States" },
  { code: "CA", dial: "1", name: "Canada" },
  { code: "NG", dial: "234", name: "Nigeria" },
  { code: "GH", dial: "233", name: "Ghana" },
  { code: "ZA", dial: "27", name: "South Africa" },
  { code: "KE", dial: "254", name: "Kenya" },
  { code: "EG", dial: "20", name: "Egypt" },
  { code: "GB", dial: "44", name: "United Kingdom" },
  { code: "IE", dial: "353", name: "Ireland" },
  { code: "FR", dial: "33", name: "France" },
  { code: "DE", dial: "49", name: "Germany" },
  { code: "ES", dial: "34", name: "Spain" },
  { code: "PT", dial: "351", name: "Portugal" },
  { code: "IT", dial: "39", name: "Italy" },
  { code: "NL", dial: "31", name: "Netherlands" },
  { code: "BE", dial: "32", name: "Belgium" },
  { code: "CH", dial: "41", name: "Switzerland" },
  { code: "AT", dial: "43", name: "Austria" },
  { code: "SE", dial: "46", name: "Sweden" },
  { code: "NO", dial: "47", name: "Norway" },
  { code: "DK", dial: "45", name: "Denmark" },
  { code: "FI", dial: "358", name: "Finland" },
  { code: "PL", dial: "48", name: "Poland" },
  { code: "GR", dial: "30", name: "Greece" },
  { code: "RU", dial: "7", name: "Russia" },
  { code: "UA", dial: "380", name: "Ukraine" },
  { code: "TR", dial: "90", name: "Turkey" },
  { code: "IN", dial: "91", name: "India" },
  { code: "PK", dial: "92", name: "Pakistan" },
  { code: "BD", dial: "880", name: "Bangladesh" },
  { code: "LK", dial: "94", name: "Sri Lanka" },
  { code: "NP", dial: "977", name: "Nepal" },
  { code: "CN", dial: "86", name: "China" },
  { code: "JP", dial: "81", name: "Japan" },
  { code: "KR", dial: "82", name: "South Korea" },
  { code: "PH", dial: "63", name: "Philippines" },
  { code: "VN", dial: "84", name: "Vietnam" },
  { code: "TH", dial: "66", name: "Thailand" },
  { code: "ID", dial: "62", name: "Indonesia" },
  { code: "MY", dial: "60", name: "Malaysia" },
  { code: "SG", dial: "65", name: "Singapore" },
  { code: "AU", dial: "61", name: "Australia" },
  { code: "NZ", dial: "64", name: "New Zealand" },
  { code: "AE", dial: "971", name: "United Arab Emirates" },
  { code: "SA", dial: "966", name: "Saudi Arabia" },
  { code: "QA", dial: "974", name: "Qatar" },
  { code: "IL", dial: "972", name: "Israel" },
  { code: "JO", dial: "962", name: "Jordan" },
  { code: "LB", dial: "961", name: "Lebanon" },
  { code: "IQ", dial: "964", name: "Iraq" },
  { code: "IR", dial: "98", name: "Iran" },
  { code: "MX", dial: "52", name: "Mexico" },
  { code: "BR", dial: "55", name: "Brazil" },
  { code: "AR", dial: "54", name: "Argentina" },
  { code: "CL", dial: "56", name: "Chile" },
  { code: "CO", dial: "57", name: "Colombia" },
  { code: "PE", dial: "51", name: "Peru" },
  { code: "VE", dial: "58", name: "Venezuela" },
  { code: "EC", dial: "593", name: "Ecuador" },
  { code: "CM", dial: "237", name: "Cameroon" },
  { code: "CI", dial: "225", name: "Ivory Coast" },
  { code: "SN", dial: "221", name: "Senegal" },
  { code: "ML", dial: "223", name: "Mali" },
  { code: "TZ", dial: "255", name: "Tanzania" },
  { code: "UG", dial: "256", name: "Uganda" },
  { code: "RW", dial: "250", name: "Rwanda" },
  { code: "ET", dial: "251", name: "Ethiopia" },
  { code: "ZM", dial: "260", name: "Zambia" },
  { code: "ZW", dial: "263", name: "Zimbabwe" },
  { code: "MZ", dial: "258", name: "Mozambique" },
  { code: "AO", dial: "244", name: "Angola" },
  { code: "MA", dial: "212", name: "Morocco" },
  { code: "DZ", dial: "213", name: "Algeria" },
  { code: "TN", dial: "216", name: "Tunisia" },
  { code: "LY", dial: "218", name: "Libya" },
  { code: "SD", dial: "249", name: "Sudan" },
];

function flagEmoji(iso2: string): string {
  return iso2
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
    .join("");
}

/**
 * Combined country-code + number input. Manages its own selected-country
 * state; calls onChange with a single digits-only string that already has
 * the dial code prepended, matching exactly what the backend already
 * expects (see auth.ts's `normalized` phone handling) — no backend or
 * calling-code changes needed.
 */
export function PhoneInput({
  value, onChange, id, className,
}: {
  value: string;
  onChange: (fullDigits: string) => void;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState<Country>(COUNTRIES[2]); // Nigeria default — primary community base
  const [localNumber, setLocalNumber] = useState("");

  const sorted = useMemo(() => [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name)), []);

  function emit(nextCountry: Country, nextLocal: string) {
    const digits = nextLocal.replace(/\D/g, "");
    onChange(`${nextCountry.dial}${digits}`);
  }

  return (
    <div className={cn("flex gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-[110px] shrink-0 justify-between bg-black/50 border-primary/30 text-white font-mono px-2"
          >
            <span className="truncate">{flagEmoji(country.code)} +{country.dial}</span>
            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-0 bg-black border-primary/30">
          <Command>
            <CommandInput placeholder="Search country..." className="text-white" />
            <CommandList>
              <CommandEmpty>No country found.</CommandEmpty>
              <CommandGroup>
                {sorted.map((c) => (
                  <CommandItem
                    key={c.code}
                    value={`${c.name} +${c.dial}`}
                    onSelect={() => {
                      setCountry(c);
                      setOpen(false);
                      emit(c, localNumber);
                    }}
                    className="text-white"
                  >
                    <Check className={cn("mr-2 h-4 w-4", country.code === c.code ? "opacity-100" : "opacity-0")} />
                    <span className="mr-2">{flagEmoji(c.code)}</span>
                    <span className="flex-1">{c.name}</span>
                    <span className="text-muted-foreground font-mono">+{c.dial}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input
        id={id}
        placeholder="801 234 5678"
        value={localNumber}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          setLocalNumber(digits);
          emit(country, digits);
        }}
        inputMode="numeric"
        maxLength={14}
        className="bg-black/50 border-primary/30 text-white placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:border-primary font-mono tracking-wider flex-1"
      />
    </div>
  );
}
