package com.hrms.api.images;

import com.hrms.core.exception.BusinessRuleException;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Iterator;

/**
 * Server-side checks and re-encoding for an employee photo, a branch logo or an
 * agency logo (V143.102). The browser already shrinks the picture, but the
 * client is untrusted: every upload is re-checked here from its bytes alone
 * (the Content-Type and file name sent with it are ignored).
 *
 * <ul>
 *   <li>Format: JPG or PNG, identified by magic bytes. Anything else (SVG,
 *       which can carry script, GIF, HEIC…) is refused.</li>
 *   <li>Size: at most 2 MB.</li>
 *   <li>Dimensions, read from the header before the picture is decoded (no
 *       decompression bombs): 64 to 6000 px on each side.</li>
 *   <li>Re-encoded at no more than 512 px: a {@link Shape#PHOTO} is cropped to a
 *       centred square and saved as JPG; a {@link Shape#LOGO} keeps its shape
 *       and transparency and is saved as PNG. Re-encoding also drops whatever
 *       metadata the file carried (a phone photo's location).</li>
 * </ul>
 *
 * <p>Pure and static so it is unit-tested without Spring.
 */
public final class RecordImage {

    public static final long MAX_BYTES = 2L * 1024 * 1024;
    public static final int MIN_SIDE = 64;
    public static final int MAX_SIDE = 6000;
    /** The longest side of what is stored. */
    public static final int OUT_SIDE = 512;

    /** How the picture is stored. */
    public enum Shape { PHOTO, LOGO }

    /** What is stored: the re-encoded bytes, their type and pixel size. */
    public record Processed(byte[] bytes, String contentType, int width, int height) {}

    private RecordImage() {}

    /** Check and re-encode {@code bytes}. Throws a {@link BusinessRuleException} with a plain-English message. */
    public static Processed process(byte[] bytes, Shape shape) {
        if (bytes == null || bytes.length == 0) {
            throw new BusinessRuleException("Choose an image to upload", "IMAGE_EMPTY");
        }
        if (bytes.length > MAX_BYTES) {
            throw new BusinessRuleException("The image must be 2 MB or smaller", "IMAGE_TOO_LARGE");
        }
        String type = sniff(bytes);
        if (type == null) {
            throw new BusinessRuleException("Only JPG and PNG images can be uploaded", "IMAGE_BAD_TYPE");
        }
        BufferedImage src = decode(bytes);
        BufferedImage out = shape == Shape.PHOTO ? squarePhoto(src) : fitLogo(src);
        byte[] encoded = shape == Shape.PHOTO ? jpeg(out) : png(out);
        if (encoded.length > MAX_BYTES) {
            // Cannot happen at 512 px, but the table refuses it anyway; say so plainly.
            throw new BusinessRuleException("The image must be 2 MB or smaller", "IMAGE_TOO_LARGE");
        }
        return new Processed(encoded, shape == Shape.PHOTO ? "image/jpeg" : "image/png", out.getWidth(), out.getHeight());
    }

    /** Magic-byte sniff: "image/jpeg", "image/png", or null for anything else. */
    static String sniff(byte[] b) {
        if (b == null || b.length < 12) return null;
        if ((b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'
                && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return "image/png";
        if ((b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) return "image/jpeg";
        return null;
    }

    /** Reads the size from the header first, then decodes. */
    static BufferedImage decode(byte[] bytes) {
        try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> readers = in == null ? null : ImageIO.getImageReaders(in);
            if (readers == null || !readers.hasNext()) throw damaged();
            ImageReader reader = readers.next();
            try {
                reader.setInput(in, true, true);
                int w = reader.getWidth(0), h = reader.getHeight(0);
                if (w > MAX_SIDE || h > MAX_SIDE) {
                    throw new BusinessRuleException("The image is " + w + " × " + h + " px. Use one no larger than "
                            + MAX_SIDE + " px on each side", "IMAGE_TOO_BIG");
                }
                if (w < MIN_SIDE || h < MIN_SIDE) {
                    throw new BusinessRuleException("The image is " + w + " × " + h + " px. It must be at least "
                            + MIN_SIDE + " px on each side", "IMAGE_TOO_SMALL");
                }
                BufferedImage img = reader.read(0);
                if (img == null) throw damaged();
                return img;
            } finally {
                reader.dispose();
            }
        } catch (BusinessRuleException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            throw damaged();
        }
    }

    private static BusinessRuleException damaged() {
        return new BusinessRuleException("This image can’t be read. Save it again as a JPG or PNG and retry", "IMAGE_UNREADABLE");
    }

    /** The centred square, at most {@link #OUT_SIDE} px, on white (JPG has no transparency). */
    static BufferedImage squarePhoto(BufferedImage src) {
        int side = Math.min(src.getWidth(), src.getHeight());
        int x = (src.getWidth() - side) / 2, y = (src.getHeight() - side) / 2;
        int out = Math.min(side, OUT_SIDE);
        BufferedImage dst = new BufferedImage(out, out, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = dst.createGraphics();
        try {
            quality(g);
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, out, out);
            g.drawImage(src, 0, 0, out, out, x, y, x + side, y + side, null);
        } finally {
            g.dispose();
        }
        return dst;
    }

    /** The whole picture, its longest side at most {@link #OUT_SIDE} px, transparency kept. */
    static BufferedImage fitLogo(BufferedImage src) {
        int w = src.getWidth(), h = src.getHeight();
        double scale = Math.min(1.0, (double) OUT_SIDE / Math.max(w, h));
        int ow = Math.max(1, (int) Math.round(w * scale)), oh = Math.max(1, (int) Math.round(h * scale));
        BufferedImage dst = new BufferedImage(ow, oh, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = dst.createGraphics();
        try {
            quality(g);
            g.drawImage(src, 0, 0, ow, oh, null);
        } finally {
            g.dispose();
        }
        return dst;
    }

    private static void quality(Graphics2D g) {
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    }

    static byte[] jpeg(BufferedImage img) {
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("jpeg");
        if (!writers.hasNext()) throw new IllegalStateException("No JPEG writer");
        ImageWriter writer = writers.next();
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ImageOutputStream out = ImageIO.createImageOutputStream(bos)) {
            writer.setOutput(out);
            ImageWriteParam p = writer.getDefaultWriteParam();
            p.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            p.setCompressionQuality(0.88f);
            writer.write(null, new IIOImage(img, null, null), p);
        } catch (IOException e) {
            throw new IllegalStateException("JPEG encode failed", e);
        } finally {
            writer.dispose();
        }
        return bos.toByteArray();
    }

    static byte[] png(BufferedImage img) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try {
            if (!ImageIO.write(img, "png", bos)) throw new IllegalStateException("No PNG writer");
        } catch (IOException e) {
            throw new IllegalStateException("PNG encode failed", e);
        }
        return bos.toByteArray();
    }
}
