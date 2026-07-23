import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ChatView } from './pages/ChatView';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ChatView />} />
      </Routes>
    </BrowserRouter>
  );
}
