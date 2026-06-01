package com.hrms.attendance.client;

import com.hrms.attendance.dto.FaceRecognitionResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.UUID;

@Component
public class FaceRecognitionClient {

    private static final Logger log = LoggerFactory.getLogger(FaceRecognitionClient.class);

    private final WebClient webClient;
    private final long timeoutSeconds;

    public FaceRecognitionClient(
            WebClient.Builder webClientBuilder,
            @Value("${hrms.face-recognition.sidecar-url:http://localhost:8085}") String sidecarUrl,
            @Value("${hrms.face-recognition.timeout-seconds:10}") long timeoutSeconds) {
        this.webClient = webClientBuilder.baseUrl(sidecarUrl).build();
        this.timeoutSeconds = timeoutSeconds;
    }

    public FaceRecognitionResult matchFace(UUID employeeId, byte[] frameData) {
        MultipartBodyBuilder bodyBuilder = new MultipartBodyBuilder();
        bodyBuilder.part("employee_id", employeeId.toString());
        bodyBuilder.part("frame", new ByteArrayResource(frameData) {
            @Override
            public String getFilename() {
                return "frame.jpg";
            }
        }).contentType(MediaType.IMAGE_JPEG);

        return webClient.post()
                .uri("/api/v1/face/match")
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(BodyInserters.fromMultipartData(bodyBuilder.build()))
                .retrieve()
                .bodyToMono(FaceRecognitionResult.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .doOnError(e -> log.error("Face recognition sidecar error for employee {}: {}", employeeId, e.getMessage()))
                .onErrorReturn(new FaceRecognitionResult(false, 0.0, employeeId.toString(), "Face recognition service unavailable"))
                .block();
    }
}
