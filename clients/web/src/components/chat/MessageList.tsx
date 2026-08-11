import React from 'react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '@/types/message';

interface MessageListProps {
  messages: ChatMessage[];
}

export const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  if (messages.length === 0) return null;

  return (
    <div className="flex flex-col">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
};
