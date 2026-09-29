# MediaPipe 로컬 런타임

- 런타임: `@mediapipe/tasks-vision` 0.10.32의 `wasm/` 파일.
- 모델: Google MediaPipe Hand Landmarker float16(version 1), Face Landmarker float16, Selfie Segmenter float16(256×256 HumanSeg).
- 손 모델 원본: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- 얼굴 모델 원본: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
- HumanSeg 모델 원본: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
- 공식 문서: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js
- 라이선스: Apache-2.0. https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE

런타임 패키지를 업데이트하면 이 폴더의 wasm 파일도 같은 버전으로 교체하세요.


## 동물의 숲 주민 생성용 모델

현재 런타임 0.10.32에 맞는 IMAGE 모드 모델을 로컬에서 사용합니다.

- [Pose Landmarker Lite float16 v1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task): 얼굴·어깨·팔·다리 33개 지점과 사람 마스크.
- [EfficientNet Lite0 float32 v1](https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite): 업로드 이미지 분류.
- [MagicTouch float32 v1](https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite): 이미지 가운데 형체의 경계. 0.10.32의 one-shot InteractiveSegmenter API를 사용하므로 신형 v2 모델과 혼용하지 않습니다.
- 기존 Selfie Segmenter의 HumanSeg confidence mask와 Pose 마스크를 교차해 카메라 사진의 배경을 제거합니다.

참고: [공식 이미지 분류 안내](https://ai.google.dev/edge/mediapipe/solutions/vision/image_classifier), [공식 인터랙티브 분할 안내](https://ai.google.dev/edge/mediapipe/solutions/vision/interactive_segmenter).
