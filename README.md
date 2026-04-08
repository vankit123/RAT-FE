# RAT-FE

`RAT-FE` là workspace frontend + Playwright runtime cho Reusable Automation Testing.

Project này chịu trách nhiệm:

- Dashboard UI để tạo project, test case, data set và chạy test.
- Recorder để ghi thao tác thực tế từ browser.
- Runtime Playwright để chạy flow đã lưu từ `RAT-BE`.
- Hiển thị kết quả chạy test, video, screenshot và tiến trình theo từng data set.

`RAT-BE` chịu trách nhiệm:

- Lưu `projects`, `test_cases`, `test_case_steps`, `test_data_sets`, `test_case_data_sets`.
- Lưu kết quả chạy test như `test_runs`, `test_run_cases`, `test_run_steps`.
- Expose API để `RAT-FE` load dữ liệu và lưu kết quả.

## Yêu cầu môi trường

- Node.js + npm
- `RAT-BE` đang chạy
- Mặc định:
  - Dashboard server: `http://127.0.0.1:3000`
  - Vite dev client: `http://127.0.0.1:3001`
  - Backend API: `http://localhost:8083/api`

Có thể đổi backend bằng biến môi trường:

```powershell
$env:RAT_BE_BASE_URL='http://localhost:8083/api'
```

## Cài đặt và chạy

```powershell
npm install
npm run dashboard
```

Mở dashboard tại:

```text
http://127.0.0.1:3000
```

Nếu đang phát triển UI React và cần hot reload:

Lưu ý:

- `3000` là dashboard server đầy đủ.
- `3001` là Vite dev client.
- Khi dev UI, thường chạy cả `npm run dashboard` và `npm run dev:client`.

## Cấu trúc chính

- [dashboard/client/src/App.tsx](/d:/Reusable%20Automation%20Testing/RAT-FE/dashboard/client/src/App.tsx): state và orchestration chính của dashboard.
- [dashboard/client/src/components](/d:/Reusable%20Automation%20Testing/RAT-FE/dashboard/client/src/components): UI React.
- [dashboard/client/src/services](/d:/Reusable%20Automation%20Testing/RAT-FE/dashboard/client/src/services): gọi API dashboard và backend.
- [dashboard/server.ts](/d:/Reusable%20Automation%20Testing/RAT-FE/dashboard/server.ts): dashboard server + API runtime.
- [dashboard/flowRunner.ts](/d:/Reusable%20Automation%20Testing/RAT-FE/dashboard/flowRunner.ts): Playwright runtime cho dashboard.
- [dashboard/recorder.ts](/d:/Reusable%20Automation%20Testing/RAT-FE/dashboard/recorder.ts): browser recorder.
- [dashboard/externalPayments/vnpayRunner.ts](/d:/Reusable%20Automation%20Testing/RAT-FE/dashboard/externalPayments/vnpayRunner.ts): xử lý riêng cho VNPAY sandbox/manual flow.
- [src/backendFlowLoader.ts](/d:/Reusable%20Automation%20Testing/RAT-FE/src/backendFlowLoader.ts): nạp test case từ backend và map sang runtime flow.

## Luồng sử dụng cơ bản

### 1. Tạo project

- Vào dashboard.
- Màn hình đầu là form tạo project.
- Nhập:
  - mã dự án
  - tên dự án
  - mô tả
  - `Base URL`
- Khi tạo project, dashboard sẽ kiểm tra `Base URL` có truy cập được hay không.

### 2. Tạo test case

Sau khi chọn project từ sidebar:

- Có danh sách test case ở trên.
- Có nút `Tạo test case`.
- Có 2 hướng:
  - `Template có sẵn`
  - `Recorder`

### 3. Tạo test case từ template

Hiện tại dashboard hỗ trợ tốt nhất cho template login:

- tạo `test_cases`
- tạo `test_case_steps`
- tạo `test_data_sets`
- gắn qua `test_case_data_sets`

### 4. Tạo test case từ recorder

- Recorder mở browser từ `Base URL` của project.
- Bạn thao tác thật trên ứng dụng.
- Sau `Stop Recording`, có thể:
  - xem step dưới dạng `Các bước`
  - xem/sửa `JSON`
  - lưu luôn thành test case trong project

Khi lưu recording thành test case:

- hệ thống tạo `test_cases`
- tạo `test_case_steps`
- tạo `test_data_sets`
- gắn data set vào test case

## Data-driven test

Một test case có thể có:

- nhiều `dataStep`
- nhiều `dataSet`

Khi chạy:

- hệ thống chạy cùng một bộ `dataStep`
- nhưng resolve `value/target/expectedValue` từ từng `dataSet`
- mỗi `dataSet` cho ra kết quả pass/fail riêng

Ví dụ placeholder:

```text
${validUser.username}
${validUser.password}
${expected.result.selector}
${expected.result.value}
```

## Chạy test từ dashboard

Trong danh sách test case:

- Bấm `Chạy test` để chạy case.
- Nếu test case có flow thủ công như VNPAY sandbox, card sẽ hiện badge:
  - `Cần thao tác thủ công`
- Nếu đang chạy test, card đó sẽ hiện:
  - `Đang chạy`
  - nút `Dừng test`

Khi dừng:

- dashboard gửi tín hiệu hủy xuống runner
- runner dừng mềm ở checkpoint gần nhất

## Latest Result

`Latest Result` hiển thị:

- lần chạy gần nhất của project đang chọn
- kết quả theo từng `dataSet`
- step pass/fail
- video
- screenshot khi fail

Nếu flow có VNPAY sandbox/manual flow, panel này cũng sẽ nhắc bạn:

- hoàn tất thanh toán thủ công trên browser đang mở
- sau đó hệ thống mới tiếp tục flow và kiểm tra điều kiện pass

## VNPAY sandbox: cách hoạt động hiện tại

### Hành vi hiện tại

Đối với các flow có đi qua `sandbox.vnpayment.vn`:

- dashboard không dùng lại gateway URL cũ đã record
- flow sẽ chờ backend redirect sang gateway mới của lần chạy hiện tại
- sau đó mở browser thật và để bạn thao tác thủ công trên VNPAY
- khi thanh toán xong và quay lại hệ thống, flow mới tiếp tục

Điều này giúp tránh lỗi do:

- dùng lại URL payment cũ
- gateway trả `403 Forbidden` cho automation
- callback không còn hợp lệ

### Rất quan trọng

Khi flow chạm VNPAY sandbox:

1. Browser đã mở sẵn từ đầu flow.
2. Dashboard dừng ở gateway.
3. Bạn tự nhập thông tin thanh toán trên VNPAY.
4. Sau khi VNPAY redirect/callback xong và browser quay lại luồng hệ thống của bạn:
   - runner tiếp tục các bước sau thanh toán
   - sau đó mới đánh giá pass/fail

### Nếu thanh toán xong nhưng runner vẫn cố fill lại field VNPAY

Ví dụ lỗi như:

```text
Could not find element for "[name=\"cardHolder\"]"
Could not find element for "[name=\"cardDate\"]"
Could not find element for "[name=\"paymethod\"]"
```

;; nguyên nhân là test case cũ vẫn còn step gateway đã record trước đó.

;; Hiện tại runner đã có logic skip mạnh hơn cho các field VNPAY phổ biến, nhưng nếu còn sót selector mới:

;; - mở test case
;; - vào `Sửa`
;; - `Edit dataStep`
;; - tìm các step thuộc VNPAY như:
;; - chọn phương thức thanh toán
;; - số thẻ
;; - chủ thẻ
;; - ngày phát hành
;; - OTP
;; - nút tiếp tục / thanh toán
;; - xóa các step đó nếu flow đang dùng manual VNPAY

;; Giữ lại:

;; - step trước khi sang payment
;; - step chờ redirect/gateway
;; - các step sau khi đã quay lại hệ thống

## Các action runtime thường dùng

Các action hiện đang hỗ trợ:

- `goto`
- `waitForUrl`
- `hover`
- `click`
- `fill`
- `press`
- `waitFor`
- `assertVisible`
- `assertText`
- `assertUrlContains`
- `payViaVnpay`

## Khi recorder không bắt được selector tốt

Đây là phần rất quan trọng khi làm test trên UI thật.

### Ưu tiên selector theo thứ tự

Nên ưu tiên:

1. `data-testid`
2. `id` ổn định
3. `aria-label` đúng trên chính element
4. text hiển thị
5. CSS selector có ý nghĩa nghiệp vụ

Không nên phụ thuộc vào:

- `#radix-...`
- `nth-of-type(...)`
- DOM path quá sâu
- class động

### Với component Radix hoặc selector động

Nếu recorder bắt ra selector kiểu:

```text
#radix-:r22:-content-week
div:nth-of-type(2) > div > div:nth-of-type(1) > div > div
```

thì nên sửa lại dataStep bằng target semantic hơn, ví dụ:

```text
kind=text::Tuần
kind=button::Dịch vụ
kind=text::Tư vấn pháp lý
kind=label::Email
```

### Khi nào nên sửa code của web đang test

Nếu bạn kiểm soát source của web đang test, nên thêm:

```html
<button data-testid="menu-services">Dịch vụ</button>
<a data-testid="submenu-legal-consulting">Tư vấn pháp lý</a>
```

hoặc:

```html
<button id="menu-services">Dịch vụ</button>
```

Đây là cách bền nhất để recorder và Playwright bắt đúng target.

### Khi hover không giống lúc record

Một số menu chỉ mở khi hover đúng trigger và chờ animation xong.

Nếu recorder ghi chưa đẹp:

- record lại flow
- ưu tiên để step là:
  - `hover` vào menu
  - `click` item con

Nếu vẫn sai:

- sửa tay `dataStep`
- đổi target sang text/button semantic

### Khi text/element xuất hiện chậm

Nếu gặp lỗi kiểu:

```text
Could not find element for "Trần Minh Hải"
```

trong khi UI thực tế có xuất hiện sau vài giây, nguyên nhân thường là:

- dữ liệu load chậm
- skeleton/loading chưa xong
- animation chưa settle

Cách xử lý:

- thêm step `waitFor`
- hoặc dùng assertion ở cuối để chờ element đủ lâu
- hoặc chỉnh step target sang phần tử ổn định hơn

## Cách chỉnh dataStep khi recorder bắt chưa đẹp

Vào:

- chọn project
- `Sửa` test case
- `Edit dataStep`

Bạn có thể:

- sửa `actionType`
- sửa `target`
- sửa `value`
- sửa `expectedValue`
- thêm step mới
- xóa step lỗi

Đối với text hiển thị, không cần bắt người dùng nhập `kind=text::...` bằng tay.

Ví dụ:

- `actionType`: `assertVisible`
- `Target type`: `Text hiển thị`
- `Nội dung / target`: `Email qa@gmail.com đã tồn tại!`
- `Expected value`: `visible`

FE sẽ tự lưu đúng định dạng runtime.

## Khi nào nên record lại thay vì sửa tay

Nên record lại nếu:

- flow thay đổi lớn
- menu hover/phức tạp bị bắt sai nhiều step liên tiếp
- nhiều selector động kiểu Radix

Nên sửa tay nếu:

- chỉ sai 1-2 step
- chỉ cần đổi selector sang semantic hơn
- cần thêm step pass condition hoặc wait step

## Build và test nhanh

Build:

```powershell
npm run build
```

Chạy test runtime:

```powershell
npm test -- --reporter=list
```

## Gợi ý vận hành hằng ngày

1. Chạy `RAT-BE`
2. Chạy `npm run dashboard`
3. Tạo project và nhập `Base URL`
4. Tạo test case bằng template hoặc recorder
5. Kiểm tra lại `dataStep`/`dataSet` nếu recorder bắt selector chưa ổn
6. Chạy test
7. Nếu case có badge `Cần thao tác thủ công`, chuẩn bị thao tác tay ở gateway/browser
8. Xem `Latest Result`, video và screenshot để chỉnh lại flow nếu cần
