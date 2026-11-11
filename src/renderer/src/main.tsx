import './styles/reset.css'
import '@lobehub/ui/theme.css'
import '@lobehub/ui/style.css'
import './styles/scrollbar.css'
import './styles/app.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'

const root = document.getElementById('root')

if (!root) {
  throw new Error('找不到根节点')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
