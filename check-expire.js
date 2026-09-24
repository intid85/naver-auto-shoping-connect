const fs = require('fs');
const path = require('path');
const statePath = path.join(process.env.USERPROFILE, '.naver-auto', 'naver-state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
const naver = state.cookies.filter(c => c.domain.includes('naver'));
console.log('네이버 쿠키 목록:');
naver.forEach(c => {
  const exp = c.expires ? new Date(c.expires * 1000).toLocaleString('ko-KR') : '세션(브라우저 닫히면 소멸)';
  console.log(`  ${c.name} → ${exp}`);
});
