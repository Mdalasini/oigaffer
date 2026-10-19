import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Game } from './game/Game'
import { App } from './ui/App'
import './index.css'

// Made once, out here: StrictMode runs component initialisers twice, and a
// second match would overwrite the first's state in the shared component
// stores, so the match played would no longer be the one its seed records.
const game = new Game()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App game={game} />
  </StrictMode>,
)
