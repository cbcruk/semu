import { Schema } from 'effect'

/** 연동할 수 있는 기관 종류입니다. 현행 `IntegrationType`(`hometax`, `cardsales` …)을 대신합니다. */
export const INSTITUTION_TYPES = [
  'HOMETAX',
  'CARD_SALES',
  'CREDIT_CARD',
  'BANK',
  'SPEED_BANK',
  'GIRO',
  'PG',
  'DELIVERY',
  'ALLRA',
] as const

/** 기관 종류입니다. */
export type InstitutionType = (typeof INSTITUTION_TYPES)[number]

/** 기관 종류 스키마입니다. */
export const InstitutionTypeSchema = Schema.Literals(INSTITUTION_TYPES)

/**
 * 연동이 기관에 로그인하는 방법입니다.
 *
 * - `ID_PASSWORD`: 기관 ID/PW. 홈택스는 조회만 됩니다
 * - `CERTIFICATE`: 등록한 공동인증서. 홈택스는 세금계산서 발급까지 됩니다
 * - `SPEED_LOOKUP`: 은행 빠른조회 전용 계정
 * - `API_KEY`: PG 상점아이디(MID)와 연동키
 * - `OAUTH`: 외부 서비스 계정 연결(올라)
 */
export type AuthMethod = 'ID_PASSWORD' | 'CERTIFICATE' | 'SPEED_LOOKUP' | 'API_KEY' | 'OAUTH'

/** 인증 방법 스키마입니다. */
export const AuthMethodSchema = Schema.Literals(['ID_PASSWORD', 'CERTIFICATE', 'SPEED_LOOKUP', 'API_KEY', 'OAUTH'])

/** 회사가 유형별로 등록할 수 있는 카드·계좌·PG 상점·배달 매장의 최대 수입니다. */
export const MAX_ITEMS_PER_TYPE = 20

/** PG사별 연동키입니다. `secret`은 암호화해 저장하고 응답에서 가립니다. */
export interface PgKeySpec {
  required: ReadonlyArray<string>
  secret: ReadonlyArray<string>
  /** PG 쪽에 미리 등록해야 하는 대사 출구 IP입니다. */
  ipWhitelist?: string
}

/** 대사 서버의 고정 출구 IP입니다. 이니시스·나이스페이에 미리 등록해야 합니다. */
export const RECONCILIATION_EGRESS_IP = '52.78.5.241'

/** PG사별로 받아야 하는 키입니다. PG사가 바꾸면 따라 바꿔야 하는 참조데이터입니다. */
export const PG_KEY_SPECS: Readonly<Record<string, PgKeySpec>> = {
  NICEPAY: { required: ['usrId', 'merchantKey'], secret: ['merchantKey'], ipWhitelist: RECONCILIATION_EGRESS_IP },
  TOSSPAYMENTS: { required: ['secretKey'], secret: ['secretKey'] },
  TOSSPAY: { required: ['apiKey'], secret: ['apiKey'] },
  UPLUS: { required: ['mertKey'], secret: ['mertKey'] },
  NAVERPAY: {
    required: ['settlementApiKey', 'clientId', 'clientSecret', 'chainId'],
    secret: ['settlementApiKey', 'clientSecret'],
  },
  HECTO: { required: ['licenseKey'], secret: ['licenseKey'] },
  INICIS: {
    required: ['reconciliationPassword'],
    secret: ['reconciliationPassword'],
    ipWhitelist: RECONCILIATION_EGRESS_IP,
  },
  EXIMBAY: { required: ['secretKey'], secret: ['secretKey'] },
  KSNET: { required: ['reconciliationApiKey'], secret: ['reconciliationApiKey'] },
}

/** 연결할 수 있는 배달앱입니다. */
export const DELIVERY_APPS = ['BAEMIN', 'COUPANG_EATS', 'YOGIYO'] as const

/**
 * 인증서 연동을 지원하지 않아 ID/PW로만 연동하는 법인카드사입니다(매뉴얼: 하나·롯데·삼성).
 *
 * 현행 카드사 코드(`001`–`020`)와 이름의 대응이 근거 자료에 없어 이름 코드로 둡니다. 코드표를 확인하면 바꿉니다.
 */
export const ID_ONLY_CORPORATE_CARD_COMPANIES: ReadonlySet<string> = new Set(['HANA', 'LOTTE', 'SAMSUNG'])

/** 인증서로 로그인할 수 있는 기관입니다. 나머지는 인증서를 받지 않습니다. */
export const CERTIFICATE_INSTITUTIONS: ReadonlySet<InstitutionType> = new Set([
  'HOMETAX',
  'GIRO',
  'BANK',
  'CREDIT_CARD',
])

/** 카드·계좌·매장처럼 연동 아래 항목을 두는 기관입니다. 한도는 항목 수로 셉니다. */
export const ITEM_INSTITUTIONS: ReadonlySet<InstitutionType> = new Set(['CREDIT_CARD', 'BANK', 'DELIVERY', 'ALLRA'])
