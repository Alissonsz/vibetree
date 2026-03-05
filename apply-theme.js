const fs = require('fs');
const path = require('path');

const colors = {
  '#09090b': '#1e1e2e',
  '#27272a': '#313244',
  '#3f3f46': '#45475a',
  '#18181b': '#181825',
  '#e4e4e7': '#cdd6f4',
  '#a1a1aa': '#bac2de',
  '#3b82f6': '#89b4fa',
  '#4ade80': '#a6e3a1',
  '#f87171': '#f38ba8',
};

const files = [
  'src/styles/layout.css',
  'src/components/Layout.tsx',
  'src/components/TerminalPane.tsx',
  'src/components/RepoPane.tsx',
  'src/components/ChangesPane.tsx',
];

for (const file of files) {
  const filePath = path.join(__dirname, file);
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [oldColor, newColor] of Object.entries(colors)) {
    content = content.split(oldColor).join(newColor);
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

console.log("Theme applied!");
