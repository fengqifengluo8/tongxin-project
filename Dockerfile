FROM eclipse-temurin:17-jre
WORKDIR /app
COPY target/tongxin-project-*.jar app.jar
EXPOSE 6061
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:6061/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
