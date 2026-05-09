# Pinned major line; bump intentionally when upgrading toolchain.
FROM rust:1.88-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Cargo.toml ./
RUN mkdir -p src && printf '%s\n' 'fn main() {}' > src/main.rs
RUN cargo fetch

COPY . .

EXPOSE 8080

CMD ["cargo", "run"]
