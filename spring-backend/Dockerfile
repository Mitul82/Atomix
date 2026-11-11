FROM maven:3.10.0-eclipse-temurin-25-alpine AS builder

WORKDIR /app

COPY pom.xml .

RUN --mount=type=cache, target=/root/.m2 mvn -B dependency:go-offline

COPY src ./src

RUN --mount=type=cache, target=/root/.m2 mvn -B clean package --DskipTests

FROM eclipse-temurin:25-jre-alpine AS runtime

WORKDIR /app

RUN addgroup -S spring && adduser -S spring -G spring

COPY --from=builder /app/target/*.jar app.jar

USER spring

EXPOSE 3000

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]