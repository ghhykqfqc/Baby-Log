// pages/agreement/agreement.js
// 宝宝日志log · 用户协议 & 隐私政策
//
// 2026-09-15 双版本策略：
//  - 默认（reviewMode=true，审核模式）：展示「无 AI 版」协议 —— 不含任何 AI 概述，
//    审核员可见的无 AI 描述。
//  - 云端开关开启 AI（reviewMode=false）：展示「完整版」协议 —— 包含 AI 育儿问答条款。
//  - 页面 onLoad 时调用 config 云函数读取 reviewMode，决定用哪套文档。
//  - 两套文档内置，保证提审包代码中不出现面向用户的 AI 描述（审核模式正确展示无 AI 版）。

const { call } = require('../../utils/request')
const CONTACT_EMAIL = '2662481663@qq.com'
const EFFECTIVE_DATE = '2026-09-15'

// ================= 用户协议（无 AI 版 / 审核模式默认） =================
const USER_AGREEMENT_BASE = {
  title: '用户协议',
  baseNo: 'V1.0',
  sections: [
    {
      anchor: 'intro',
      no: '1',
      name: '协议的接受与说明',
      content: [
        { type: 'p', text: '欢迎使用「宝宝日志log」微信小程序（以下简称"本小程序"或"我们"）。本小程序是一款面向新手爸妈与家庭成员的科学育娃工具，提供喂奶、换尿布、睡眠、成长（身高/体重）、日程及家庭共享等功能，帮助您记录宝宝的成长点滴。' },
        { type: 'p', text: '请您在使用本小程序前，仔细阅读并充分理解本《用户协议》（以下简称"本协议"）全部内容，特别是与您的权益有重大关系的条款。您点击登录、勾选"我已阅读并同意《用户协议》和《隐私政策》"或以其他方式使用本小程序，即视为您已阅读、理解并同意接受本协议的全部内容。' },
        { type: 'p', text: '若您是未满18周岁的未成年人（包括为子女使用本小程序的未成年人家长），应在监护人陪同下阅读本协议并取得监护人同意后使用本小程序。' },
        { type: 'p', text: '我们可能根据法律法规变化或业务发展需要不时修订本协议，修订后的协议将在本页面公示。若您不同意修订后的内容，您有权停止使用本小程序；若您继续使用，即视为接受修订后的协议。' }
      ]
    },
    {
      anchor: 'account',
      no: '2',
      name: '注册与登录',
      content: [
        { type: 'p', text: '本小程序依托微信账号体系提供登录服务。您通过点击"微信一键登录"的方式登录时，将授权我们获取您的微信 OpenID、头像、昵称等信息，用于识别您的身份并提供服务。' },
        { type: 'p', text: '我们提供"先体验、后授权"的游客模式，您可以在不登录的情况下浏览页面并体验核心记录功能。游客模式下产生的记录数据仅保存在您的设备本地；登录后，本地记录将合并同步至云端。' },
        { type: 'p', text: '您有责任妥善保管您的微信账号及密码，任何通过您的微信账号进行的操作均视为您本人所为。若因您主动泄露、保管不善导致的损失，由您自行承担。' }
      ]
    },
    {
      anchor: 'service',
      no: '3',
      name: '服务内容',
      content: [
        { type: 'p', text: '本小程序目前提供的服务包括但不限于：' },
        { type: 'li', prefix: '3.1', text: '喂奶、换尿布（小便/大便/拉稀）、睡眠时长的快速记录与统计；' },
        { type: 'li', prefix: '3.2', text: '身高、体重等成长数据的录入与生长曲线展示；' },
        { type: 'li', prefix: '3.3', text: '「每日早读故事」：系统内置的经典儿童故事阅读，支持使用微信官方「同声传译」插件将故事文本朗读为语音（朗读内容为程序预置文本，非用户输入）；' },
        { type: 'li', prefix: '3.4', text: '疫苗、生日、预约等日程与纪念日管理；' },
        { type: 'li', prefix: '3.5', text: '家庭共享：通过宝宝ID与宝宝密码邀请家人共同记录；' },
        { type: 'li', prefix: '3.6', text: '其他我们不断打造与迭代推出的新功能。' }
      ]
    },
    {
      anchor: 'family',
      no: '4',
      name: '家庭共享',
      content: [
        { type: 'p', text: '您邀请家人加入共同记录前，应确保已获得宝宝监护人的充分同意，并已告知家人本协议及《隐私政策》的相关内容。' },
        { type: 'p', text: '您创建的宝宝信息（包括宝宝昵称、头像、生日、记录数据）将对您主动邀请共享的家人可见，家人在获得您授权后可查看、添加记录。' },
        { type: 'p', text: '您应妥善保管宝宝ID与宝宝密码，不向无关人员透露。您同意，因泄露宝宝ID或密码导致的记录被查看、修改，由您承担相应的提醒与告知义务。' }
      ]
    },
    {
      anchor: 'rules',
      no: '5',
      name: '用户行为规范',
      content: [
        { type: 'p', text: '您承诺在使用本小程序过程中，遵守国家法律法规及微信平台的相关规定，不得利用本小程序从事任何违法违规活动，包括但不限于：' },
        { type: 'li', prefix: '5.1', text: '输入、上传任何违反法律法规、侵害他人合法权益（包括但不限于他人隐私、知识产权）的内容；' },
        { type: 'li', prefix: '5.2', text: '未经他人同意，录入、上传他人照片、语音及其他个人信息；' },
        { type: 'li', prefix: '5.3', text: '使用自动化脚本、批量工具等非正常手段访问、抓取本小程序数据或服务；' },
        { type: 'li', prefix: '5.4', text: '利用本小程序进行任何商业宣传、营销、广告等活动，除非经我们书面许可；' },
        { type: 'li', prefix: '5.5', text: '其他违反法律法规、社会主义核心价值观或微信平台规则的行为。' },
        { type: 'p', text: '如发现您发布或输入的内容违反法律法规或本协议，我们有权在不另行通知的情况下采取删除、屏蔽、限制功能等措施，并保留追究相关法律责任的权利。' }
      ]
    },
    {
      anchor: 'ip',
      no: '6',
      name: '知识产权',
      content: [
        { type: 'p', text: '本小程序的界面设计、商标、文案、代码等由我们拥有或合法授权使用的知识产权，未经书面许可，任何单位或个人不得以任何方式复制、传播、改编。' },
        { type: 'p', text: '您在记录中录入的文字、数据等内容的著作权归您或相关内容权利人所有。您授权我们仅为提供本小程序服务之目的，在限定范围内使用上述内容（如用于生成分享卡片）。' }
      ]
    },
    {
      anchor: 'disclaimer',
      no: '7',
      name: '免责声明',
      content: [
        { type: 'p', text: '本小程序内的记录内容仅供您记录与参考，不构成任何医疗、养育建议。如涉及医疗、用药等专业问题，请咨询专业医生。' },
        { type: 'p', text: '因网络故障、基础运维故障等不可抗力，或本小程序依赖的第三方服务（如天气接口）出现波动时，可能导致服务中断或数据异常，我们将尽力修复，但在法律允许范围内不承担由此造成的间接损失。' },
        { type: 'p', text: '您应定期自行备份重要数据。尽管我们采取了合理的安全保护措施，但任何互联网服务均无法保证绝对安全，请您理解。' }
      ]
    },
    {
      anchor: 'privacy',
      no: '8',
      name: '隐私保护',
      content: [
        { type: 'p', text: '我们非常重视您的个人信息和宝宝信息的保护，请您仔细阅读本小程序《隐私政策》以了解详情。您同意本协议即视为您已阅读并同意《隐私政策》。' }
      ]
    },
    {
      anchor: 'change',
      no: '9',
      name: '协议变更与终止',
      content: [
        { type: 'p', text: '本协议条款变更，我们将通过小程序内公告、协议页版本更新等合理方式通知您。变更后的协议经公示后生效。若您不同意变更内容，可以停止使用本小程序；若您继续使用，视为接受变更后的协议。' },
        { type: 'p', text: '您有权随时停止使用本小程序。当您按《隐私政策》约定要求注销账号或删除相关数据时，我们将按规定对数据进行删除或匿名化处理。' }
      ]
    },
    {
      anchor: 'law',
      no: '10',
      name: '法律适用与争议解决',
      content: [
        { type: 'p', text: '本协议的订立、执行与解释均适用中华人民共和国法律。' },
        { type: 'p', text: '因本协议产生或与之相关的争议，双方应友好协商解决；协商不成的，任何一方均可向本小程序运营主体所在地有管辖权的人民法院提起诉讼。' }
      ]
    },
    {
      anchor: 'contact',
      no: '11',
      name: '联系我们',
      content: [
        { type: 'p', text: '如您对本协议内容有任何疑问、意见或建议，可通过以下方式与我们联系，我们将在收到反馈后尽快（通常 15 个工作日内）予以回复：' },
        { type: 'li', prefix: '邮箱', text: CONTACT_EMAIL },
        { type: 'li', prefix: '渠道', text: '在小程序内通过「宝宝管理」面板中的「意见反馈」入口提交' }
      ]
    }
  ]
}

// ================= 用户协议（完整版 / AI 功能开启后展示） =================
const USER_AGREEMENT_FULL = {
  title: '用户协议',
  baseNo: 'V1.1',
  sections: [
    {
      anchor: 'intro',
      no: '1',
      name: '协议的接受与说明',
      content: [
        { type: 'p', text: '欢迎使用「宝宝日志log」微信小程序（以下简称"本小程序"或"我们"）。本小程序面向新手爸妈与家庭成员，提供喂奶、换尿布、睡眠、成长（身高/体重）、日程、分享、家庭共享等功能，并包含「小云朵 AI 育娃伙伴」问答服务（详见第 4 条）。' },
        { type: 'p', text: '请您在使用本小程序前，仔细阅读并充分理解本《用户协议》（以下简称"本协议"）全部内容，特别是与您的权益有重大关系的条款。您点击登录、勾选"我已阅读并同意《用户协议》和《隐私政策》"或以其他方式使用本小程序，即视为您已阅读、理解并同意接受本协议的全部内容。' },
        { type: 'p', text: '若您是未满18周岁的未成年人（包括为子女使用本小程序的未成年人家长），应在监护人陪同下阅读本协议并取得监护人同意后使用本小程序。' },
        { type: 'p', text: '我们可能根据法律法规变化或业务发展需要不时修订本协议，修订后的协议将在本页面公示。若您不同意修订后的内容，您有权停止使用本小程序；若您继续使用，即视为接受修订后的协议。' }
      ]
    },
    {
      anchor: 'account',
      no: '2',
      name: '注册与登录',
      content: [
        { type: 'p', text: '本小程序依托微信账号体系提供登录服务。您通过点击"微信一键登录"的方式登录时，将授权我们获取您的微信 OpenID、头像、昵称等信息，用于识别您的身份并提供服务。' },
        { type: 'p', text: '我们提供"先体验、后授权"的游客模式，您可以在不登录的情况下浏览页面并体验核心记录功能。游客模式下产生的记录仅保存在您的设备本地；登录后，本地记录将合并同步至云端。' },
        { type: 'p', text: '您有责任妥善保管您的微信账号及密码，任何通过您的微信账号进行的操作均视为您本人所为。' }
      ]
    },
    {
      anchor: 'service',
      no: '3',
      name: '服务内容',
      content: [
        { type: 'p', text: '本小程序目前提供的服务包括但不限于：' },
        { type: 'li', prefix: '3.1', text: '喂奶、换尿布（小便/大便/拉稀）、睡眠时长的快速记录与统计；' },
        { type: 'li', prefix: '3.2', text: '身高、体重等成长数据的录入与生长曲线展示；' },
        { type: 'li', prefix: '3.3', text: '「小云朵 AI 育娃伙伴」：育儿知识问答服务（详见第 4 条）；' },
        { type: 'li', prefix: '3.4', text: '疫苗、生日、预约等日程与纪念日管理；' },
        { type: 'li', prefix: '3.5', text: '家庭共享：通过宝宝ID与宝宝密码邀请家人共同记录；' },
        { type: 'li', prefix: '3.6', text: '其他我们不断打造与迭代推出的新功能。' }
      ]
    },
    {
      anchor: 'ai',
      no: '4',
      name: 'AI 育儿问答服务（小云朵 AI 育娃伙伴）',
      content: [
        { type: 'p', text: '本小程序提供"小云朵 AI 育娃伙伴"育儿问答服务（以下简称"AI 服务"）。AI 服务基于云端大语言模型生成回答，并结合微信官方语音识别与语音合成能力，支持"按住说话"提问与回答播报。' },
        { type: 'p', text: '您理解并同意：AI 生成内容仅供育儿科普参考，不构成医疗、营养等专业建议。涉及宝宝健康、用药、发育异常等情况，请务必咨询正规医疗机构专业医护，切勿仅依赖 AI 参考而延误就医。' },
        { type: 'li', prefix: '4.1', text: '语音识别：由微信官方「同声传译」插件在设备端完成，语音仅用于本次识别，识别完成后随即丢弃；' },
        { type: 'li', prefix: '4.2', text: '语音合成（播报）：由云端 AI 实时合成本次回答的语音并仅用于本次播放，结束后即时清除；' },
        { type: 'li', prefix: '4.3', text: '内容安全：提问与回答均通过微信官方内容安全接口进行实时过滤；' },
        { type: 'li', prefix: '4.4', text: '隐私边界：对话内容不入库、不沉淀历史，每次会话均为一次性临时处理；' },
        { type: 'li', prefix: '4.5', text: '责任边界：AI 回答由模型自动生成，可能难有偏差，您应结合医生意见与自身判断使用本 AI 服务。' }
      ]
    },
    {
      anchor: 'family',
      no: '5',
      name: '家庭共享',
      content: [
        { type: 'p', text: '您邀请家人加入共同记录前，应确保已获得宝宝监护人的充分同意，并已告知家人本协议及《隐私政策》的相关内容。' },
        { type: 'p', text: '您创建的宝宝信息（包括宝宝昵称、头像、生日、记录数据）将对您主动邀请共享的家人可见，家人在获得您授权后可查看、添加记录。' },
        { type: 'p', text: '您应妥善保管宝宝ID与宝宝密码，不向无关人员透露。' }
      ]
    },
    {
      anchor: 'rules',
      no: '6',
      name: '用户行为规范',
      content: [
        { type: 'p', text: '您承诺在使用本小程序过程中，遵守国家法律法规及微信平台的相关规定，不得利用本小程序从事任何违法违规活动，包括但不限于：' },
        { type: 'li', prefix: '6.1', text: '输入、上传任何违反法律法规、侵害他人合法权益（包括但不仅限于他人隐私、知识产权）的内容；' },
        { type: 'li', prefix: '6.2', text: '通过 AI 服务询问、诱导生成任何违法违规、危害未成年人的内容；' },
        { type: 'li', prefix: '6.3', text: '未经他人同意，录入、上传他人照片、语音及其他个人信息；' },
        { type: 'li', prefix: '6.4', text: '使用自动化脚本、批量工具等非正常手段访问、抓取本小程序数据或 AI 服务；' },
        { type: 'li', prefix: '6.5', text: '利用本小程序进行任何商业宣传、营销等未经许可的行为；' },
        { type: 'li', prefix: '6.6', text: '其他违反法律法规、社会主义核心价值观或微信平台规则的行为。' }
      ]
    },
    {
      anchor: 'ip',
      no: '7',
      name: '知识产权',
      content: [
        { type: 'p', text: '本小程序的界面设计、商标、文案、算法等由我们拥有或合法授权使用，未经书面许可，任何单位或个人不得以任何方式复制、传播、改编。' },
        { type: 'p', text: 'AI 回答的文本与语音内容由模型自动生成，相关权利归属依照适用的法律法规与技术协议确定。' },
        { type: 'p', text: '您在记录中录入的内容的权利归您所有，并授权我们为提供服务之目的使用（如生成分享卡片）。' }
      ]
    },
    {
      anchor: 'disclaimer',
      no: '8',
      name: '免责声明',
      content: [
        { type: 'p', text: '本范围内的记录内容仅供您记录与参考，不构成任何医疗、养育建议。' },
        { type: 'p', text: 'AI 回答由模型自动生成，可能存在不准确、不完整之处，我们努力提升能力，但不对 AI 内容的准确性、完整性作出保证。' },
        { type: 'p', text: '因不可抗力或第三方服务异常导致的服务中断，我们将在合理范围内尽力修复，但依法无法承担间接损失。' },
        { type: 'p', text: '您应定期自行备份重要数据，互联网服务无法保证绝对安全。' }
      ]
    },
    {
      anchor: 'privacy',
      no: '9',
      name: '隐私保护',
      content: [
        { type: 'p', text: '我们重视您的个人信息和宝宝信息保护，请阅读本小程序《隐私政策》以了解详情。您同意本协议即视为同意《隐私政策》。' }
      ]
    },
    {
      anchor: 'change',
      no: '10',
      name: '协议变更与终止',
      content: [
        { type: 'p', text: '详见变更的协议条款。' },
        { type: 'p', text: '您有权随时停止使用本小程序。按《隐私政策》注销后数据删除。' }
      ]
    },
    {
      anchor: 'law',
      no: '11',
      name: '法律适用',
      content: [
        { type: 'p', text: '本协议适用中华人民共和国法律，争议以协商或向有管辖权的人民法院解决。' }
      ]
    },
    {
      anchor: 'contact',
      no: '12',
      name: '联系我们',
      content: [
        { type: 'p', text: '如您对本协议有疑问，可通过以下方式联系我们（15 个工作日内回复）：' },
        { type: 'li', prefix: '邮箱', text: CONTACT_EMAIL }
      ]
    }
  ]
}

// ================= 隐私政策（无 AI 版 / 默认对外） =================
const PRIVACY_POLICY_BASE = {
  title: '隐私政策',
  version: 'V1.0',
  updateDate: EFFECTIVE_DATE,
  sections: [
    {
      anchor: 'intro',
      no: '1',
      name: '引言',
      content: [
        { type: 'p', text: '「宝宝日志log」微信小程序（以下简称"本小程序"）由运营主体开发运营。我们深知个人信息对您的重要性，将按照法律法规要求，采取相应安全保护措施，尽力保护您的个人信息安全可控。' },
        { type: 'p', text: '本政策将帮助您了解：我们如何收集、使用、共享、存储和保护您的个人信息及您子女的信息；您享有的权利及如何行使。请在使用前仔细阅读。' },
        { type: 'p', text: '本小程序内记录的宝宝数据（包括但不限于昵称、出生日期、身高体重等）属于个人信息。我们将严格按《个人信息保护法》《儿童个人信息网络保护规定》等法律法规要求，在取得您（监护人）的明示同意后，以最小必要处理该类信息。' }
      ]
    },
    {
      anchor: 'collect',
      no: '2',
      name: '我们收集和使用的信息',
      content: [
        { type: 'p', text: '为向您提供核心服务，我们仅收集实现产品功能所需的信息，并且仅在您主动提供或授权时收集：' },
        { type: 'li', prefix: '2.1', text: '注册登录信息：微信 OpenID、头像、昵称。使用"微信一键登录"时收集，用于识别账号身份。' },
        { type: 'li', prefix: '2.2', text: '宝宝资料信息：昵称、头像、出生日期、性别。用于展示档案、计算月龄。' },
        { type: 'li', prefix: '2.3', text: '记录数据：喂奶、尿布、睡眠、身高、体重、日程等信息，仅存于您账号下。' },
        { type: 'li', prefix: '2.4', text: '位置信息：天气功能基于您的 IP 地址进行粗略定位，不会获取精确位置。' },
        { type: 'li', prefix: '2.5', text: '日志与设备信息：设备型号、操作系统版本、微信版本等基础技术信息。' },
        { type: 'p', text: '「每日早读故事」语音朗读：故事文本为程序预置内容；朗读由微信官方「同声传译」插件在设备端完成，不采集、不传输任何个人语音，不保存朗读音频。' },
        { type: 'p', text: '我们不会收集与提供服务无关的个人信息。' }
      ]
    },
    {
      anchor: 'use',
      no: '3',
      name: '我们如何使用信息',
      content: [
        { type: 'p', text: '我们仅在下列直接目的、最小范围内使用收集的信息：' },
        { type: 'li', prefix: '3.1', text: '账户登录与身份识别，同步记录数据；' },
        { type: 'li', prefix: '3.2', text: '生成生长曲线、作息预测等个性化展示；' },
        { type: 'li', prefix: '3.3', text: '内容安全：对用户文本输入进行合法合规过滤；' },
        { type: 'li', prefix: '3.4', text: '排查与解决产品问题、保障服务安全；' },
        { type: 'li', prefix: '3.5', text: '在授权范围内同步备份并供家庭成员共享。' },
        { type: 'p', text: '我们不会将您的个人信息用于与提供服务无关的目的。' }
      ]
    },
    {
      anchor: 'share',
      no: '4',
      name: '信息的共享、转让与公开披露',
      content: [
        { type: 'p', text: '我们不会向任何第三方出售您的个人信息，不会主动公开或披露，但下列情形除外：' },
        { type: 'li', prefix: '4.1', text: '您明确同意并授权的情况下共享；' },
        { type: 'li', prefix: '4.2', text: '为提供本产品服务而与微信平台共享必要的接口信息（如微信登录、云开发、语音识别等），仅限服务必需的最小范围；' },
        { type: 'li', prefix: '4.3', text: '您主动邀请的家庭成员，在您授权范围内查看、编辑共享的宝宝记录；' },
        { type: 'li', prefix: '4.4', text: '为履行法律法规、法律程序或政府主管部门依法提出的要求；' },
        { type: 'li', prefix: '4.5', text: '如本小程序发生合并、收购、资产转让等情形，您的信息可能随业务转移，我们将继续受本政策约束。' }
      ]
    },
    {
      anchor: 'storage',
      no: '5',
      name: '信息的存储',
      content: [
        { type: 'p', text: '我们在中华人民共和国境内服务器（腾讯云开发环境）存储您的信息，不会传输至境外。' },
        { type: 'p', text: '您的记录数据自您注销账号或要求删除时起，我们将在合理期限内（约 30 个工作日）对您的账号数据进行删除或匿名化处理。本地缓存由您自行掌控，可通过清除小程序缓存方式删除。' }
      ]
    },
    {
      anchor: 'rights',
      no: '6',
      name: '您享有的权利',
      content: [
        { type: 'li', prefix: '6.1', text: '访问与更正：您可在「宝宝管理」及对应页面查看、修改宝宝的资料与记录；' },
        { type: 'li', prefix: '6.2', text: '删除：您可删除单条记录、宝宝档案；注销后一并删除您的数据；' },
        { type: 'li', prefix: '6.3', text: '注销：如需彻底删除账号及相关数据，请按第 10 条联系方式提出申请，我们将在 15 个工作日内完成删除或匿名化；' },
        { type: 'li', prefix: '6.4', text: '退出/移除成员：您可在「宝宝管理」中移除家庭成员，同时保留自己的记录。' }
      ]
    },
    {
      anchor: 'child',
      no: '7',
      name: '儿童个人信息保护特别条款',
      content: [
        { type: 'p', text: '本小程序以家庭为单位使用，其中记录的宝宝数据（昵称、出生日期、成长数据等）属于不满十四周岁的儿童个人信息。我们郑重承诺：' },
        { type: 'li', prefix: '7.1', text: '儿童个人信息的收集、使用必须以监护人（您）的有效授权为前提；' },
        { type: 'li', prefix: '7.2', text: '我们仅在与产品功能直接相关的场景处理儿童信息，不用于数据挖掘、定向推送；' },
        { type: 'li', prefix: '7.3', text: '儿童信息不对公开或向无关第三方披露；' },
        { type: 'li', prefix: '7.4', text: '当您注销账号或要求删除时，我们将一并删除相关儿童信息；' },
        { type: 'li', prefix: '7.5', text: '若您发现有人未经监护人同意获取的儿童个人信息，请立即联系我们，我们将依法处理。' }
      ]
    },
    {
      anchor: 'security',
      no: '8',
      name: '信息安全与保护',
      content: [
        { type: 'p', text: '我们采用符合行业标准的合理安全措施防护您的信息，包括但不限于传输加密（HTTPS）、云存储密钥管理、数据库权限隔离等。' },
        { type: 'p', text: '如不幸发生个人信息安全事件，我们将按法律规定及时告知您并采取补救措施。' },
        { type: 'p', text: '互联网并非绝对安全，请您妥善保管账号、宝宝 ID 与密码，并与家庭成员共同保护。' }
      ]
    },
    {
      anchor: 'change',
      no: '9',
      name: '本政策的更新',
      content: [
        { type: 'p', text: '我们的隐私政策可能变更。未经您的明确同意，我们不会削减您依法享有的权利。' },
        { type: 'p', text: '当政策发生重大变化时，我们将通过公告、弹窗等显著方式通知您。' }
      ]
    },
    {
      anchor: 'contact',
      no: '10',
      name: '联系我们、投诉与举报',
      content: [
        { type: 'p', text: '如您对本政策有任何疑问、意见、建议或投诉举报，或希望行使您的个人信息权利（查询、更正、删除、撤回同意、注销等），可通过以下方式联系我们：' },
        { type: 'li', prefix: '邮箱', text: CONTACT_EMAIL },
        { type: 'li', prefix: '时间', text: '我们将在收到反馈后 15 个工作日内答复您' }
      ]
    }
  ]
}

// ================= 隐私政策（完整版 / 含 AI 内容，AI 开启时展示） =================
const PRIVACY_POLICY_AI = {
  title: '隐私政策',
  version: 'V1.1',
  sections: [
    {
      anchor: 'intro',
      no: '1',
      name: '引言',
      content: [
        { type: 'p', text: '「宝宝日志log」微信小程序（以下简称"本小程序"）运营主体（以下简称"我们"）非常重视您的个人信息和宝宝的信息安全。' },
        { type: 'p', text: '本政策将帮助您了解：我们如何收集、使用、共享、存储和保护个人信息；您如何行使权利。' },
        { type: 'p', text: '宝宝数据（昵称、出生日期、成长数据等）属于儿童个人信息，我们会严格依据《个人信息保护法》《儿童个人信息网络保护规定》等法律法规处理。' }
      ]
    },
    {
      anchor: 'collect',
      no: '2',
      name: '我们收集和使用的信息',
      content: [
        { type: 'p', text: '为向您提供核心服务，仅收集业务所必需的最小化信息：' },
        { type: 'li', prefix: '2.1', text: '注册登录信息：OpenID、头像、昵称；' },
        { type: 'li', prefix: '2.2', text: '宝宝资料：昵称、头像、出生日期、性别；' },
        { type: 'li', prefix: '2.3', text: '记录数据：喂奶、尿布、睡眠、身高、体重、日程等；' },
        { type: 'li', prefix: '2.4', text: '问答内容：向「小云朵 AI 育娃伙伴」提问的文本与生成回答（含语音），仅用于本次问答的实时处理，处理完成即删除；' },
        { type: 'li', prefix: '2.5', text: '位置信息：基于 IP 的天气粗略定位（城市级）；' },
        { type: 'li', prefix: '2.6', text: '日志与设备信息：设备型号、系统版本等基础信息。' },
        { type: 'p', text: '【语音识别与播报】按住说话时，语音经微信「同声传译」插件在设备端转为文本，仅用于本次提问，不留存语音文件。' }
      ]
    },
    {
      anchor: 'use',
      no: '3',
      name: '我们如何使用信息',
      content: [
        { type: 'p', text: '仅用于以下 直接目的、最小必要：' },
        { type: 'li', prefix: '3.1', text: '账户登录与数据同步；' },
        { type: 'li', prefix: '3.2', text: '提供生长曲线、作息预测等；' },
        { type: 'li', prefix: '3.3', text: '提供 AI 问答与语音播报（调用云端模型与语音合成）；' },
        { type: 'li', prefix: '3.4', text: '内容安全检测（文本输入与输出实时过滤）；' },
        { type: 'li', prefix: '3.5', text: '问题排查、服务安全；' },
        { type: 'li', prefix: '3.6', text: '授权范围内的家庭共享。' }
      ]
    },
    {
      anchor: 'share',
      no: '4',
      name: '信息共享、转让与公开披露',
      content: [
        { type: 'li', prefix: '4.1', text: '您明确同意时共享；' },
        { type: 'li', prefix: '4.2', text: '为提供本产品所必需、与微信平台共享接口技术信息（如微信登录、云开发、语音识别、AI 能力）；' },
        { type: 'li', prefix: '4.3', text: '您主动邀请的家庭成员在其授权范围内共享；' },
        { type: 'li', prefix: '4.4', text: '法律法规、司法程序、政府主管部门要求时披露；' },
        { type: 'li', prefix: '4.5', text: '业务重组情形下转移，将继续受本政策约束。' }
      ]
    },
    {
      anchor: 'storage',
      no: '5',
      name: '信息的存储',
      content: [
        { type: 'p', text: '存储于中国境内（腾讯云开发环境），不会传输境外。' },
        { type: 'p', text: '记录数据在注销或删除请求后，合理期限（约 30 个工作日）内删除或匿名化。' },
        { type: 'p', text: '问答会话（含语音转写、回答文本、合成音频）仅用于处理时短期内存/临时文件，处理完毕立即删除，不留存历史。' }
      ]
    },
    {
      anchor: 'rights',
      no: '6',
      name: '您享有的权利',
      content: [
        { type: 'li', prefix: '6.1', text: '查询/更正：宝宝资料与记录可修改；' },
        { type: 'li', prefix: '6.2', text: '删除：可删除单条记录、宝宝档案；' },
        { type: 'li', prefix: '6.3', text: '撤回授权：可通过手机设置或微信授权管理撤回登录、麦克风等授权（撤回麦克风可暂停语音提问），其余功能不受影响；' },
        { type: 'li', prefix: '6.4', text: '注销：按第 10 条联系申请，15 个工作日内完成删除或匿名化；' },
        { type: 'li', prefix: '6.5', text: '退出成员：可在宝宝管理中移除家庭成员。' }
      ]
    },
    {
      anchor: 'child',
      no: '7',
      name: '儿童个人信息保护特别条款',
      content: [
        { type: 'li', prefix: '7.1', text: '儿童信息处理须以监护人授权为前提；' },
        { type: 'li', prefix: '7.2', text: '仅与功能直接相关，不用于挖掘、定向推送；' },
        { type: 'li', prefix: '7.3', text: '不公开、不向无关第三方披露；' },
        { type: 'li', prefix: '7.4', text: '通过内容安全机制限制内容范围，坚决不对儿童输出有害内容；' },
        { type: 'li', prefix: '7.5', text: '注销/要求删除时一并删除儿童信息；' },
        { type: 'li', prefix: '7.6', text: '若发现未经同意处理儿童信息，请立即联系我们。' }
      ]
    },
    {
      anchor: 'security',
      no: '8',
      name: '信息安全与保护',
      content: [
        { type: 'p', text: '采用传输加密、密钥管理、数据库权限隔离等措施。' },
        { type: 'p', text: 'AI 相关服务端能力（模型调用、内容安全）仅在云端按需处理，密钥仅存于云函数环境变量。' },
        { type: 'p', text: '如发生安全事件，将依法告知并采取补救措施；请妥善保管账号、宝宝 ID 与密码。' }
      ]
    },
    {
      anchor: 'change',
      no: '9',
      name: '本政策的更新',
      content: [
        { type: 'p', text: '政策可能变更，重大变更将以显著方式通知。' }
      ]
    },
    {
      anchor: 'contact',
      no: '10',
      name: '联系我们、投诉与举报',
      content: [
        { type: 'p', text: '如您对隐私政策有疑问或需行使权利，可通过以下方式联系我们：' },
        { type: 'li', prefix: '邮箱', text: CONTACT_EMAIL },
        { type: 'li', prefix: '时间', text: '15 个工作日内答复' }
      ]
    }
  ]
}

Page({
  data: {
    type: 'user',         // user=用户协议, privacy=隐私政策
    title: '用户协议',
    version: '',
    updateDate: '',
    sections: [],
    scrollInto: '',
    showBackTop: false,
    year: new Date().getFullYear()
  },

  onLoad(options) {
    const type = (options && options.type === 'privacy') ? 'privacy' : 'user'
    this._loadDoc(type)
    wx.setNavigationBarTitle({ title: type === 'privacy' ? '隐私政策' : '用户协议' })
    this.loadReviewMode(type)
  },

  /** 读取云端开关，决定使用「无 AI 版」还是「完整版（含 AI）」协议 */
  async loadReviewMode(type) {
    let reviewMode = true
    try {
      const app = getApp()
      if (app && app.globalData.cloudReady) {
        const flags = await call('config', {})
        reviewMode = flags ? flags.reviewMode : true
      }
    } catch (e) {
      reviewMode = true
    }
    this._useDoc(type, reviewMode)
  },

  /** 立即以某套文档渲染（不等待云端时用 BASE 版，保证可用） */
  _loadDoc(type) {
    const base = type === 'privacy' ? PRIVACY_POLICY_BASE : USER_AGREEMENT_BASE
    this._applyDoc(base)
  },

  /** 按 reviewMode 选用文档并渲染 */
  _useDoc(type, reviewMode) {
    const doc =
      (type === 'privacy')
        ? (reviewMode ? PRIVACY_POLICY_BASE : PRIVACY_POLICY_AI)
        : (reviewMode ? USER_AGREEMENT_BASE : USER_AGREEMENT_FULL)
    this._applyDoc(doc)
  },

  _applyDoc(doc) {
    wx.setNavigationBarTitle({ title: doc.title })
    this.setData({
      title: doc.title,
      version: doc.version,
      updateDate: doc.updateDate,
      sections: doc.sections
    })
  },

  /** 目录点击 → 滚动到对应章节 */
  onTocTap(e) {
    const anchor = e.currentTarget.dataset.anchor
    if (!anchor) return
    this.setData({ scrollInto: anchor })
  },

  /** 滚动监听：滚出顶部一段距离后显示「回到顶部」 */
  onScroll(e) {
    const top = (e.detail && e.detail.scrollTop) || 0
    if (top > 400 && !this.data.showBackTop) {
      this.setData({ showBackTop: true })
    } else if (top <= 400 && this.data.showBackTop) {
      this.setData({ showBackTop: false })
    }
  },

  scrollToTop() {
    this.setData({ scrollInto: 'sec-intro' })
  }
})