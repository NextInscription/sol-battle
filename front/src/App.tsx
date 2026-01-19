import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import Lobby from './pages/Lobby';
import CreateBattle from './pages/CreateBattle';
import History from './pages/History';
import BattleDetail from './pages/BattleDetail';
import BattleDebugger from './pages/BattleDebugger';
import { DeepLinkListener } from './utils/deepLinkListener';

function App() {
  useEffect(() => {
    // 初始化深度链接监听器（仅在移动端）
    if (Capacitor.isNativePlatform()) {
      DeepLinkListener.initialize();
    }
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/create" element={<CreateBattle />} />
        <Route path="/history" element={<History />} />
        <Route path="/battle/:battlePda" element={<BattleDetail />} />
        <Route path="/debug" element={<BattleDebugger />} />
      </Routes>
    </Router>
  );
}

export default App;
