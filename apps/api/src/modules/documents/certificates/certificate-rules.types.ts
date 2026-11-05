/** 제증명 발급 상태입니다. 현행 `DELETE` 대신 `VOIDED`로 남깁니다. */
export type CertificateStatus = 'ISSUED' | 'SENDING' | 'SENT' | 'SEND_FAILED' | 'VOIDED'

/** 증명서 상태를 옮기는 사건입니다. `DELIVERED`·`DELIVERY_FAILED`는 발송 결과입니다. */
export type CertificateCommand = 'SEND' | 'VOID' | 'DELIVERED' | 'DELIVERY_FAILED'
