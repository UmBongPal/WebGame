# BLOCKFALL

순수 HTML/CSS/JS 정적 사이트 — 빌드 없음, 서버리스 함수 없음, 외부 리소스 없음.
Netlify 무료 플랜에서 빌드 분 0, 함수 호출 0, 대역폭은 첫 방문 약 20KB.

## 로컬 실행
python3 -m http.server -d public 8080

## 배포
- 드래그 앤 드롭: https://app.netlify.com/drop 에 `public` 폴더 업로드
  (보안 헤더는 public/_headers 에 있어 이 방식에서도 적용됨)
- CLI: npx netlify-cli deploy --prod   (프로젝트 루트에서 실행)
- Git 연동: 저장소 연결 후 Build command 비움, Publish directory `public`
