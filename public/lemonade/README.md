# Lemonade 이미지 바꾸기

1. 배경이 투명한 레몬 이미지를 이 폴더(`public/lemonade`)에 넣습니다. 예: `lemon.png`.
2. `config.json`의 `image`를 `"lemon.png"`로 바꾸고 새로고침합니다.
3. PNG, WebP, SVG를 사용할 수 있습니다. 이미지 바깥의 투명 여백은 작게 해 주세요.

기본 제공하는 `lemon.svg`로 이미지 추가 전에도 실행됩니다. 이미지 로드에 실패하면 기본 레몬을 표시합니다. 외부 주소 대신 이 폴더의 파일을 사용합니다.

```json
{
  "image": "lemon.png",
  "lemonCount": 6,
  "juicePerLemon": 100,
  "cupCapacity": 300
}
```

- `lemonCount`: 떠 있는 레몬 개수, 1–12.
- `juicePerLemon`: 레몬 하나의 즙 양(ml), 10–500. 약 3.5초 동안 짜면 소진됩니다.
- `cupCapacity`: 컵의 용량(ml), 50–3000.
- 다 짠 레몬은 찌그러진 채 떨어지고 새로운 레몬으로 교체됩니다.
- 컵이 가득 차면 `새로 만들기`로 비울 수 있습니다.
