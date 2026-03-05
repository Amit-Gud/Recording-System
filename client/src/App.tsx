import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Dashboard     from "./components/Dashboard/Dashboard";
import LiveView      from "./components/LiveView/LiveView";
import ReplayPlayer  from "./components/ReplayPlayer/ReplayPlayer";
import SessionBrowser from "./components/SessionBrowser/SessionBrowser";
import AllBookmarks  from "./components/BookmarkPanel/AllBookmarks";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                                  element={<Dashboard />} />
        <Route path="/live/:agentId"                     element={<LiveView />} />
        <Route path="/replay/:agentId/:date"             element={<ReplayPlayer />} />
        <Route path="/sessions/:agentId"                 element={<SessionBrowser />} />
        <Route path="/bookmarks"                         element={<AllBookmarks />} />
        <Route path="*"                                  element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
