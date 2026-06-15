import React from 'react';

import { listStarred } from '../../../../shared/services/backendApi';
import ChatPanel from '../ChatPanel';
import GoogleAccountModal from '../GoogleAccountModal';
import type { Loose } from './types';

interface ChatAccountOverlayProps {
  routeUiCollapsed: boolean;
  gptChatOpen: boolean;
  geminiChatOpen: boolean;
  gptHistory: Loose[];
  geminiHistory: Loose[];
  chatInput: string;
  setChatInput: Loose;
  gptLoading: boolean;
  geminiLoading: boolean;
  handleChat: Loose;
  handleTargetedQuickAction: Loose;
  isRecording: boolean;
  handleMicStart: Loose;
  handleMicStop: Loose;
  kbHeight: number;
  gptScrollRef: Loose;
  geminiScrollRef: Loose;
  googleUser: Loose;
  insets: Loose;
  micLoading: boolean;
  setGptChatOpen: Loose;
  setGeminiChatOpen: Loose;
  showAccountModal: boolean;
  setShowAccountModal: Loose;
  setGoogleUser: Loose;
  isMountedRef: React.MutableRefObject<boolean>;
  setStarredPOIs: Loose;
}

const ChatAccountOverlay: React.FC<ChatAccountOverlayProps> = ({
  routeUiCollapsed,
  gptChatOpen,
  geminiChatOpen,
  gptHistory,
  geminiHistory,
  chatInput,
  setChatInput,
  gptLoading,
  geminiLoading,
  handleChat,
  handleTargetedQuickAction,
  isRecording,
  handleMicStart,
  handleMicStop,
  kbHeight,
  gptScrollRef,
  geminiScrollRef,
  googleUser,
  insets,
  micLoading,
  setGptChatOpen,
  setGeminiChatOpen,
  showAccountModal,
  setShowAccountModal,
  setGoogleUser,
  isMountedRef,
  setStarredPOIs,
}) => {
  if (routeUiCollapsed) return null;

  return (
    <>
      <ChatPanel
        gptChatOpen={gptChatOpen}
        geminiChatOpen={geminiChatOpen}
        gptHistory={gptHistory}
        geminiHistory={geminiHistory}
        chatInput={chatInput}
        setChatInput={setChatInput}
        gptLoading={gptLoading}
        geminiLoading={geminiLoading}
        handleChat={handleChat}
        onTargetedQuickAction={handleTargetedQuickAction}
        isRecording={isRecording}
        handleMicStart={handleMicStart}
        handleMicStop={handleMicStop}
        kbHeight={kbHeight}
        gptScrollRef={gptScrollRef}
        geminiScrollRef={geminiScrollRef}
        googleUser={googleUser}
        insets={insets}
        micLoading={micLoading}
        onClose={() => { setGptChatOpen(false); setGeminiChatOpen(false); }}
      />

      <GoogleAccountModal
        visible={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        currentAccount={googleUser}
        onConnected={(email: string) => {
          setGoogleUser({ email });
          listStarred(email)
            .then((places) => {
              if (isMountedRef.current) setStarredPOIs(places);
            })
            .catch(() => undefined);
        }}
        onDisconnected={() => {
          setGoogleUser(null);
          setStarredPOIs([]);
        }}
      />
    </>
  );
};

export default ChatAccountOverlay;
