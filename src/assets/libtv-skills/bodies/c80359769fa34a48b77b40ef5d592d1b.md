```
{
  "skillId": "skill_image_to_videocover",
  "skillName": "原图调性视频海报封面生成",
  "version": "1.2.0",
  "author": "Design Assistant",
  "description": "上传一张参考图片，AI自动识别原图色彩、光影、质感和构图调性，生成吸睛视频海报封面；启动后弹窗询问是否自定义标题，选择自定义则使用输入文案，不自定义AI自动识别画面产品、品牌、场景生成TVC主题标题，标题醒目突出适配短视频封面传播需求。",
  "inputParams": [{"paramKey":"referenceImage","paramName":"参考图片","type":"image","required":true,"description":"上传作为风格参考的原图，AI将提取画面色彩、光影、质感、美术风格、主体信息与构图逻辑"},{"paramKey":"titleText","paramName":"自定义封面标题","type":"text","required":false,"defaultValue":"","description":"弹窗选择手动输入标题时生效，填写封面主标题；不填写将由AI自动生成主题文案"},{"paramKey":"canvasRatio","paramName":"画面比例","type":"select","required":false,"defaultValue":"16:9","options":[{"label":"横版16:9（短视频/TVC）","value":"16:9"},{"label":"竖版9:16（抖音/视频号封面）","value":"9:16"},{"label":"21:9超宽电影海报","value":"21:9"},{"label":"1:1正方形封面","value":"1:1"}],"description":"输出海报画布尺寸比例"},{"paramKey":"imageModel","paramName":"生图模型","type":"select","required":true,"defaultValue":"LIB_IMAGE_STANDARD_2K","options":[{"label":"LIB IMAGE 标准画质 2K","value":"LIB_IMAGE_STANDARD_2K"},{"label":"LIB IMAGE 高清质感 4K","value":"LIB_IMAGE_HD_4K","disabledReason":"暂不支持，请选择 LIB IMAGE 标准画质 2K"},{"label":"LIB IMAGE 电影风格模型","value":"LIB_IMAGE_CINEMATIC","disabledReason":"暂不支持，请选择 LIB IMAGE 标准画质 2K"}],"description":"当前仅支持 LIB IMAGE 标准画质 2K，选择其他模型将弹出提示"}],
  "outputType": "image",
  "outputCount": 1,
  "promptTemplate": {"baseRule":"严格参考上传参考图片的整体调性：色彩色系、光影明暗、材质质感、艺术风格、氛围情绪、构图逻辑，不脱离原图气质。生成专业商业视频海报封面，高清，电影级光影，细节精致，边缘干净，适合用作视频首帧封面。标题视觉占比充足，字体偏大，醒目突出，具备视觉冲击力，满足短视频封面引流需求。","branchWithTitle":"{{baseRule}}，画面合理预留文字区域，精美版式排版，添加主标题【{{titleText}}】，字体尺寸充足、醒目突出，字体视觉匹配画面风格，文字清晰有冲击力，不被画面元素遮挡，主次层次分明。比例 {{canvasRatio}}","branchAutoTitle":"{{baseRule}}，先识别图片内产品、品牌、场景、核心氛围，提炼简洁高级的TVC封面标题，例如「XX产品TVC」、主题宣传短句，文案风格贴合画面调性；画面预留文字区域，标题字体放大、视觉突出，具备吸引力，文字协调醒目，不遮挡画面主体。比例 {{canvasRatio}}"},
  "negativePrompt": "文字过小，标题不起眼，文字杂乱，水印，模糊，低分辨率，畸形物体，刺眼高饱和冲突色彩，多余边框，涂鸦，劣质网图质感，多标题重叠，文字遮挡核心画面，文案冗长低俗，字体纤细难以识别",
  "workflowScript": "popup '是否需要手动输入封面标题？选择【是】请填写标题文案，选择【否】AI自动生成封面主题标题';if input.imageModel != 'LIB_IMAGE_STANDARD_2K' then popup '当前仅支持 LIB IMAGE 标准画质 2K，请重新选择模型。';else if input.titleText != '' then use branchWithTitle; else use branchAutoTitle;",
  "advancedConfig": {"styleWeight":0.85,"imageSimilarity":0.75,"resolution":"2048px","sampler":"DPM++ 2M Karras"},
  "tag": ["海报封面","视频封面","风格复刻","图生图","主视觉","短视频封面","TVC海报","智能文案"]
}
```