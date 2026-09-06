import { useState } from "react";
import { Bell, CheckCircle2, Loader2, Settings } from "lucide-react";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from "@sigmagit/hooks";
import { Link } from "@tanstack/react-router";
import { NotificationItem } from "./notification-item";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const { data: notificationsData, isLoading } = useNotifications({ limit: 10, enabled: open });
  const { data: unreadData } = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const notifications = notificationsData?.notifications || [];
  const unreadCount = unreadData?.count || 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-lg"
        >
          <Bell className="size-5" />
        {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 size-4 bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center rounded-full shadow-sm animate-in zoom-in-50 duration-200">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(24rem,calc(100vw-1rem))] p-0 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <span className="font-semibold text-sm">Notifications</span>
          <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <Button
              variant="ghost"
                size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
                className="h-8 text-xs"
            >
              {markAllRead.isPending ? (
                <Loader2 className="size-3 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="size-3 mr-1" />
              )}
              Mark all read
            </Button>
          )}
            <Link to="/settings/notifications">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Settings className="size-4" />
              </Button>
            </Link>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="p-8 text-center">
              <Loader2 className="size-8 mx-auto animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center">
              <div className="size-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <Bell className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkRead={() => {
                    if (!notification.read) {
                      markRead.mutate(notification.id);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {notifications.length > 0 && (
          <div className="border-t border-border p-2 bg-muted/30">
            <Link
              to="/notifications"
              className="block text-center text-sm text-muted-foreground hover:text-foreground py-2 rounded-lg hover:bg-accent transition-colors"
            >
              View all notifications
            </Link>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
