package com.hrms.api.workforce.images;

import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** V143.102: what an employee photo, branch logo or agency logo upload accepts, and what is stored. */
class RecordImageTest {

    private static byte[] image(String format, int w, int h, boolean alpha) throws Exception {
        BufferedImage img = new BufferedImage(w, h, alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setColor(Color.ORANGE);
        g.fillRect(0, 0, w / 2, h);
        g.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        assertThat(ImageIO.write(img, format, out)).isTrue();
        return out.toByteArray();
    }

    private static BufferedImage read(byte[] b) throws Exception {
        return ImageIO.read(new ByteArrayInputStream(b));
    }

    @Test
    void aPhotoIsCroppedToASquareJpgOfAtMost512() throws Exception {
        RecordImage.Processed p = RecordImage.process(image("png", 1200, 800, false), RecordImage.Shape.PHOTO);
        assertThat(p.contentType()).isEqualTo("image/jpeg");
        assertThat(p.width()).isEqualTo(512);
        assertThat(p.height()).isEqualTo(512);
        assertThat(RecordImage.sniff(p.bytes())).isEqualTo("image/jpeg");
        assertThat(read(p.bytes()).getWidth()).isEqualTo(512);
    }

    @Test
    void aSmallPhotoIsNotEnlarged() throws Exception {
        RecordImage.Processed p = RecordImage.process(image("jpg", 300, 200, false), RecordImage.Shape.PHOTO);
        assertThat(p.width()).isEqualTo(200);
        assertThat(p.height()).isEqualTo(200);
    }

    @Test
    void aLogoKeepsItsShapeAndTransparencyAsPng() throws Exception {
        RecordImage.Processed p = RecordImage.process(image("png", 1024, 256, true), RecordImage.Shape.LOGO);
        assertThat(p.contentType()).isEqualTo("image/png");
        assertThat(p.width()).isEqualTo(512);
        assertThat(p.height()).isEqualTo(128);
        BufferedImage back = read(p.bytes());
        assertThat(back.getColorModel().hasAlpha()).isTrue();
        // The right half was left transparent.
        assertThat((back.getRGB(500, 60) >>> 24)).isZero();
    }

    @Test
    void anythingButJpgOrPngIsRefused() throws Exception {
        byte[] gif = image("gif", 200, 200, false);
        assertThatThrownBy(() -> RecordImage.process(gif, RecordImage.Shape.PHOTO))
                .isInstanceOf(BusinessRuleException.class).hasMessage("Only JPG and PNG images can be uploaded");
        byte[] svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>".getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> RecordImage.process(svg, RecordImage.Shape.LOGO))
                .isInstanceOf(BusinessRuleException.class).hasMessage("Only JPG and PNG images can be uploaded");
    }

    @Test
    void emptyTooLargeTooSmallAndDamagedFilesAreRefused() throws Exception {
        assertThatThrownBy(() -> RecordImage.process(new byte[0], RecordImage.Shape.PHOTO)).hasMessage("Choose an image to upload");
        byte[] big = new byte[(int) RecordImage.MAX_BYTES + 1];
        System.arraycopy(image("png", 100, 100, false), 0, big, 0, 16);
        assertThatThrownBy(() -> RecordImage.process(big, RecordImage.Shape.PHOTO)).hasMessage("The image must be 2 MB or smaller");
        assertThatThrownBy(() -> RecordImage.process(image("png", 40, 40, false), RecordImage.Shape.PHOTO))
                .hasMessageContaining("at least 64 px");
        byte[] png = image("png", 200, 200, false);
        byte[] cut = java.util.Arrays.copyOf(png, 40);
        assertThatThrownBy(() -> RecordImage.process(cut, RecordImage.Shape.PHOTO))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("can’t be read");
    }

    @Test
    void aHugeImageIsRefusedFromItsHeaderAlone() throws Exception {
        // A PNG whose header claims 20000 × 20000 px (a decompression bomb): refused before decoding.
        byte[] png = image("png", 100, 100, false);
        png[16] = 0; png[17] = 0; png[18] = 0x4E; png[19] = 0x20;   // width 20000
        png[20] = 0; png[21] = 0; png[22] = 0x4E; png[23] = 0x20;   // height 20000
        assertThatThrownBy(() -> RecordImage.process(png, RecordImage.Shape.LOGO))
                .isInstanceOf(BusinessRuleException.class);
    }

    @Test
    void kindsParse() {
        assertThat(RecordImageService.Kind.parse("Employee")).isEqualTo(RecordImageService.Kind.EMPLOYEE);
        assertThat(RecordImageService.Kind.parse("branch")).isEqualTo(RecordImageService.Kind.BRANCH);
        assertThat(RecordImageService.Kind.parse("agency")).isEqualTo(RecordImageService.Kind.AGENCY);
        assertThat(RecordImageService.Kind.parse("company")).isNull();
        assertThat(RecordImageService.path(java.util.UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
                java.util.UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")))
                .isEqualTo("/v1/public/images/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    }
}
