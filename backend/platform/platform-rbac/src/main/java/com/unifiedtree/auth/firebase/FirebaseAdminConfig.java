package com.unifiedtree.auth.firebase;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;

/**
 * Boots the Firebase Admin SDK so {@link com.google.firebase.auth.FirebaseAuth}
 * can verify ID tokens minted by our Android app's phone-auth flow.
 *
 * <p>Credential source is Application Default Credentials — Cloud Run runs
 * with the service account bound to the revision, and locally the tokens
 * from {@code gcloud auth application-default login} are picked up. There
 * is intentionally no key file baked into the image.
 *
 * <p>Project id is hard-wired to the same GCP project the rest of the
 * platform uses ({@code unifiedtree-445cd}). The Firebase Auth tenant that
 * mints the ID tokens on the client lives here, so ID-token verification
 * must be scoped to the same project — otherwise every token is rejected
 * with a "wrong audience" error.
 *
 * <p>Idempotent: if a FirebaseApp is already initialized (e.g. another test
 * or a hot-reload) we reuse the default instance rather than crashing on
 * the "duplicate app" IllegalStateException.
 */
@Configuration
public class FirebaseAdminConfig {

    private static final Logger log = LoggerFactory.getLogger(FirebaseAdminConfig.class);

    /** Same GCP project id used for FCM, Cloud SQL, Cloud Run, etc. */
    private static final String PROJECT_ID = "unifiedtree-445cd";

    @Bean
    public FirebaseApp firebaseApp() throws IOException {
        // Reuse the already-initialised default app if one exists — starting
        // a second one throws IllegalStateException("FirebaseApp name [DEFAULT]
        // already exists!") and would poison the whole context refresh.
        if (!FirebaseApp.getApps().isEmpty()) {
            log.info("Firebase Admin SDK already initialised; reusing default FirebaseApp");
            return FirebaseApp.getInstance();
        }

        FirebaseOptions options = FirebaseOptions.builder()
                .setCredentials(GoogleCredentials.getApplicationDefault())
                .setProjectId(PROJECT_ID)
                .build();
        FirebaseApp app = FirebaseApp.initializeApp(options);
        log.info("Firebase Admin SDK initialised for project {}", PROJECT_ID);
        return app;
    }
}
