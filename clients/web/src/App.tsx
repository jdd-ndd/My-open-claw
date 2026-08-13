import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useSession } from '@/hooks/useSession';
import { useAppStore } from '@/stores/useAppStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Sparkles } from 'lucide-react';
import { PptStudio } from '@/views/PptStudio';
import { SystemOverview } from '@/views/SystemOverview';
import { Memory } from '@/views/Memory';

function ChatPage() {
  const { currentSessionId, ensureSession, switchSession, sessions } = useSession();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();

  // URL 路径 /s/:sessionId → 自动切换到该 session
  useEffect(() => {
    if (routeSessionId && sessions.some((s) => s.id === routeSessionId) && routeSessionId !== currentSessionId) {
      switchSession(routeSessionId);
    }
  }, [routeSessionId, sessions, currentSessionId, switchSession]);

  useEffect(() => {
    ensureSession();
  }, [ensureSession]);

  if (!currentSessionId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-primary flex items-center justify-center shadow-glow">
            <Sparkles className="w-7 h-7 text-primary-foreground animate-pulse" />
          </div>
          <p className="font-display text-lg font-semibold text-foreground mb-1">正在初始化</p>
          <p className="text-sm text-muted-foreground">正在准备对话环境，请稍候...</p>
          <div className="mt-4 w-32 h-1 mx-auto rounded-full bg-muted overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-gradient-primary animate-gradient-shift" />
          </div>
        </div>
      </div>
    );
  }

  return <ChatContainer sessionId={currentSessionId} />;
}

/** /settings 路由：自动打开 Settings 抽屉 */
function SettingsRoute() {
  const setOpen = useAppStore((s) => s.setSettingsPanelOpen);
  useEffect(() => {
    setOpen(true);
  }, [setOpen]);
  // 抽屉是浮层，主内容仍然显示聊天
  return <ChatPage />;
}

export default function App() {
  useWebSocket();

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <AppLayout>
                <ChatPage />
              </AppLayout>
            }
          />
          <Route
            path="/s/:sessionId"
            element={
              <AppLayout>
                <ChatPage />
              </AppLayout>
            }
          />
          <Route
            path="/settings"
            element={
              <AppLayout>
                <SettingsRoute />
              </AppLayout>
            }
          />
          <Route
            path="/ppt"
            element={
              <AppLayout>
                <PptStudio />
              </AppLayout>
            }
          />
          <Route
            path="/system"
            element={
              <AppLayout>
                <SystemOverview />
              </AppLayout>
            }
          />
          <Route
            path="/memory"
            element={
              <AppLayout>
                <Memory />
              </AppLayout>
            }
          />
          <Route
            path="*"
            element={
              <AppLayout>
                <ChatPage />
              </AppLayout>
            }
          />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
