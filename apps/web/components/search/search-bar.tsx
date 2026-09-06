import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Command, FileText, GitBranch, Hash, Loader2, Search, User } from "lucide-react";
import { useSearch } from "@sigmagit/hooks";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const typeIcons: Record<string, React.ReactNode> = {
  repository: <GitBranch className="size-4" />,
  user: <User className="size-4" />,
  issue: <FileText className="size-4" />,
  pull_request: <GitBranch className="size-4" />,
  code: <FileText className="size-4" />,
  default: <Hash className="size-4" />,
};

export function SearchBar({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSettledQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const isSettled = query.trim() === settledQuery;
  const { data, isFetching } = useSearch(settledQuery, {
    enabled: isOpen && isSettled && settledQuery.length >= 2,
  });
  const isLoading = isOpen && query.trim().length >= 2 && (!isSettled || isFetching);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === "/" || (e.metaKey && e.key === "k")) && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    }

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      navigate({ to: "/search", search: { q: query } });
      setIsOpen(false);
    }
  }

  function handleResultClick(url: string) {
    navigate({ to: url });
    setIsOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <form onSubmit={handleSubmit}>
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder="Search or jump to..."
            className="pl-10 pr-20 h-11 w-full bg-muted/50 border-transparent focus-visible:bg-background focus-visible:border-primary/30 transition-all duration-200"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {isLoading ? (
              <Loader2 className="size-4 text-muted-foreground animate-spin" />
            ) : (
              <>
                <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium text-muted-foreground border border-border/50">
                  <Command className="size-3" />
                  <span>K</span>
                </kbd>
              </>
          )}
          </div>
        </div>
      </form>

      {isOpen && isSettled && query.length >= 2 && data?.results && data.results.length > 0 && (
        <div className="absolute top-full mt-2 w-full bg-popover border border-border rounded-xl shadow-2xl max-h-[400px] overflow-y-auto z-[60] p-2">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Results
          </div>
          {data.results.map((result, index) => (
            <button
              key={`${result.type}-${result.id}`}
              onClick={() => handleResultClick(result.url)}
              className={cn(
                "w-full p-3 text-left rounded-lg transition-all duration-150",
                "hover:bg-accent hover:text-accent-foreground",
                "focus:bg-accent focus:text-accent-foreground focus:outline-none"
              )}
            >
              <div className="flex items-start gap-3">
                <div className="size-8 rounded-lg bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                  {typeIcons[result.type] || typeIcons.default}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{result.title}</div>
                  {result.description && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {result.description}
                    </div>
                  )}
                  {result.repository && (
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <GitBranch className="size-3" />
                      {result.repository.owner}/{result.repository.name}
                      {result.number && <span className="text-primary">#{result.number}</span>}
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
          <div className="border-t border-border mt-2 pt-2">
          <button
            onClick={() => handleSubmit({ preventDefault: () => { } } as React.FormEvent)}
              className="w-full p-3 text-left rounded-lg text-sm text-primary hover:bg-accent hover:text-accent-foreground transition-all duration-150 flex items-center gap-2"
          >
              <Search className="size-4" />
            See all results for "{query}"
          </button>
          </div>
        </div>
      )}

      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
      {isOpen && isSettled && query.length >= 2 && data?.results?.length === 0 && !isLoading && (
        <div className="absolute top-full mt-2 w-full bg-popover border border-border rounded-xl shadow-2xl z-[60] p-6 text-center">
          <div className="size-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
            <Search className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No results found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try adjusting your search terms
          </p>
        </div>
      )}
    </div>
  );
}
