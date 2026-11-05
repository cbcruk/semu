import type { DocumentForm } from './document-forms.types'

/**
 * The 서식 모음 catalog, transcribed from the Alfred manual's list of 39 forms.
 *
 * Titles, descriptions and categories are product data. The download files
 * are not part of this repository, so `file_url` is `null` until they are hosted.
 */
export const DOCUMENT_FORMS: readonly DocumentForm[] = [
  { id: 1, title: '경력증명서', description: '기업에 재직 중이거나 퇴직한 후, 해당 회사에서 경력사항을 증명하는 문서입니다.', type: '인사', file_url: null },
  { id: 2, title: '근로계약서-건설일용근로자', description: '건설일용근로자 채용시 사용하는 계약서입니다.', type: '인사', file_url: null },
  { id: 3, title: '근로계약서-단시간근로자', description: '단시간근로자 채용시 사용하는 계약서입니다.', type: '인사', file_url: null },
  { id: 4, title: '근로계약서-연소근로자', description: '연소근로자(18세 미만) 채용시 사용하는 계약서입니다.', type: '인사', file_url: null },
  { id: 5, title: '근로계약서-외국인근로자', description: '외국인근로자 채용시 사용하는 계약서입니다.', type: '인사', file_url: null },
  { id: 6, title: '근로계약서-정규직근로자', description: '일반적인 근로소득자 채용시 사용하는 계약서입니다.', type: '인사', file_url: null },
  { id: 7, title: '법인대표자 무보수 확인서', description: '국민건강보험공단에 제출하는 법인대표자의 무보수 확인서 입니다.', type: '인사', file_url: null },
  { id: 8, title: '비거주자 제한세율 적용신청서', description: '국내 원천소득이 있는 비거주자가 각 국가와 체결된 조세조약에 따른 제한세율을 적용 받고자 하는 경우 작성하는 신청서입니다.', type: '인사', file_url: null },
  { id: 9, title: '비밀유지서약서', description: '회사에 대한 정보가 외부로 유출되지 않게 하기 위하여 근로자에게 작성을 하도록 하는 문서입니다.', type: '인사', file_url: null },
  { id: 10, title: '사직서', description: '근로자가 사직 의사를 전달하기 위해 작성하는 문서입니다.', type: '인사', file_url: null },
  { id: 11, title: '재직증명서', description: '회사에서 근로자의 근로기간, 직책 등의 재직사항을 증명하여 발급하는 문서입니다.', type: '인사', file_url: null },
  { id: 12, title: '퇴직증명서', description: '근로소득자의 퇴직 사실을 증명하는 문서입니다.', type: '인사', file_url: null },
  { id: 13, title: '표준취업규칙', description: '고용노동부가 2019년 3월까지 변경된 노동법의 개정사항을 반영하여 발표한 표준취업규칙입니다.', type: '인사', file_url: null },
  { id: 14, title: '프리랜서 계약서', description: '프리랜서(사업소득자)와의 계약을 체결하는 문서입니다.', type: '인사', file_url: null },
  { id: 15, title: '해고통지서', description: '직원에게 해고 사실을 서면으로 통지하기 위한 문서입니다. 5인 이상 기업에서는 해고 시 반드시 서면으로 통지해야 합니다.', type: '인사', file_url: null },
  { id: 16, title: '해촉증명서', description: '과납했던 보험료를 반환 받기 위해 작성하는 문서입니다', type: '인사', file_url: null },
  { id: 17, title: '휴직원', description: '근로소득자가 사정에 의하여 휴직하고자 할 때에 사용하는 문서입니다.', type: '인사', file_url: null },
  { id: 18, title: '거래명세서', description: '거래처 간 거래를 하고 그에 따른 상세한 명세 내역을 기록하는 문서입니다. 거래명세서는 세무 상 증빙자료로 이용될 수 없으며, 세금계산서와 함께 발행하여야 합니다.', type: '경리', file_url: null },
  { id: 19, title: '기타매출', description: '세금계산서/계산서/신용카드/현금영수증 외의 매출내역들에 대하여 기입하는 서식입니다.', type: '경리', file_url: null },
  { id: 20, title: '세금계산서', description: '부가가치세법 시행규칙 [별지 제14호서식] 세금계산서 [시행 2022. 1. 1.] [기획재정부령 제846호, 2021. 3. 16., 일부개정]', type: '경리', file_url: null },
  { id: 21, title: '월별거래명세', description: '판매대행업을 하는 경우 매 분기 관련 명세를 국세청(홈택스)에 제출할 때 사용하는 문서입니다.', type: '경리', file_url: null },
  { id: 22, title: '지출결의서(경비처리용)', description: '사업용카드 외의 카드로 사업관련한 지출을 하였으나, 부가세 공제 대상이 아니거나 또는 현금으로 사업관련 지출을 하였을 시에 작성하는 서식입니다.', type: '경리', file_url: null },
  { id: 23, title: '지출결의서(부가세공제용)', description: '사업용카드 외의 카드로 사업관련하여 지출한 내역을 부가세 신고 시 세액공제받기 위한 목적으로 작성하는 서식입니다.', type: '경리', file_url: null },
  { id: 24, title: '차량운행일지', description: '차량의 행선지 및 주요사항을 일자별로 기록하는 문서입니다.', type: '경리', file_url: null },
  { id: 25, title: '무상임대차계약서', description: '임차인이 임대인으로부터 임대료 없이 무상으로 빌려서 사용하기로 할 때에 작성하는 문서입니다.', type: '부동산', file_url: null },
  { id: 26, title: '부동산임대차계약서', description: '임차인이 임대인으로부터 해당 부동산을 일정한 기간동안 임대하는 대가로 차임을 지불할 것을 약정할 때에 작성하는 문서입니다.', type: '부동산', file_url: null },
  { id: 27, title: '전대계약서', description: '목적물을 다시 제3자에게 사용, 수익하게 할 것을 약정하는 서식입니다.', type: '부동산', file_url: null },
  { id: 28, title: '전대동의서', description: '목적물을 다시 제3자에게 빌려주는 것을 동의함을 증명하는 서식입니다.', type: '부동산', file_url: null },
  { id: 29, title: '주식양수도계약서', description: '보유한 주식에 대한 권리를 이전 권리자가 새로운 권리자에게 양수/양도 한다는 내용을 작성하는 계약 문서입니다.', type: '주식', file_url: null },
  { id: 30, title: '주식증여계약서', description: '증여자가 수증자에게 증여하는 것을 약정하며 그에 관한 권리 및 의무를 기록하는 문서입니다.', type: '주식', file_url: null },
  { id: 31, title: '주주명부', description: '주주 및 주권에 관한 사항을 명확히 하기 위하여 작성하는 서식입니다.', type: '주식', file_url: null },
  { id: 32, title: '이사회의사록-대표이사무보수', description: '법인의 대표이사 급여를 무보수로 처리할 시에 사대보험 공단에 제출해야 하는 서류 중 하나로, 대표이사 무보수에 대한 사항이 이사회를 통해 결정되었다는 내용을 기재하는 서식입니다.', type: '이사회', file_url: null },
  { id: 33, title: '이사회의사록-지점설치', description: '지점 설치에 대한 사항이 이사회를 통해 결정 되었다는 내용을 기재하는 서식입니다.', type: '이사회', file_url: null },
  { id: 34, title: '금전소비대차계약서', description: '일반적인 금전소비대차 거래시 작성하는 계약서 입니다. 특수관계자와의 거래시 당좌대출 이자율 확인하여 작성하시기 바랍니다.', type: '일반계약', file_url: null },
  { id: 35, title: '동업계약서', description: '동업자 간 사업 운영에 따른 계약 의무 사항을 작성하는 문서입니다.', type: '일반계약', file_url: null },
  { id: 36, title: '무상차입금계약서', description: '외부에서 자금을 차입하고 명시된 차입기간동안 이자를 무상으로 계약할 때에 작성하는 문서입니다.', type: '일반계약', file_url: null },
  { id: 37, title: '사업양수도계약서', description: '회사의 사업에 관한 권리와 의무를 이전 권리자가 새로운 권리자에게 양수/양도 한다는 내용으로 작성하는 계약 문서입니다.', type: '일반계약', file_url: null },
  { id: 38, title: '위임장', description: '위임자가 위임 받는 자에게 업무 처리를 위탁하여 업무를 대행하게 할 때에 작성하는 서식입니다.', type: '일반계약', file_url: null },
  { id: 39, title: '차용증', description: '돈이나 물건을 빌린 것을 증명하기 위하여 빌린 시기, 빌린 내용 등을 기록하여 채무인과 채권자 사이에 작성하는 문서입니다.', type: '일반계약', file_url: null },
]
