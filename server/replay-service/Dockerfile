FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY . .
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -o replay-service .

FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/replay-service .

EXPOSE 8003
CMD ["./replay-service"]
