import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SetupPage } from './pages/SetupPage';
import { GamePage } from './pages/GamePage';
import { AnalysisPage } from './pages/AnalysisPage';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SetupPage />} />
        <Route path="/game" element={<GamePage />} />
        <Route path="/game/:gameId" element={<GamePage />} />
        <Route path="/analysis/:gameId" element={<AnalysisPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
