package com.hrms.api.workforce.search;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Query normalisation, type keywords, and that typed words only ever reach SQL as bound parameters. */
class SearchTextTest {

    @Test
    void normalisesLikeThePeopleSearch() {
        SearchText t = SearchText.of("  Ravi   KUMAR ");
        assertThat(t.normalized()).isEqualTo("ravi kumar");
        assertThat(t.tokens()).containsExactly("ravi", "kumar");
        assertThat(SearchText.of(" a ").tooShort()).isTrue();
        assertThat(SearchText.of("ab").tooShort()).isFalse();
    }

    @Test
    void aWordThatNamesTheTypeListsThatTypeInsteadOfFilteringOnIt() {
        SearchText t = SearchText.of("leave ravi");
        assertThat(t.namesType(SearchType.LEAVE)).isTrue();
        assertThat(t.wordsFor(SearchType.LEAVE)).containsExactly("ravi");
        // Other types still need both words.
        assertThat(t.wordsFor(SearchType.DOCUMENT)).containsExactly("leave", "ravi");
        assertThat(SearchText.of("payslips").wordsFor(SearchType.PAYSLIP)).isEmpty();
        // A prefix is not the type's name ("lea" could be someone called Lea).
        assertThat(SearchText.of("lea").wordsFor(SearchType.LEAVE)).containsExactly("lea");
    }

    @Test
    void likeWildcardsTypedByThePersonAreMatchedLiterally() {
        assertThat(SearchText.contains("50%_off")).isEqualTo("%50\\%\\_off%");
        assertThat(SearchText.contains("a\\b")).isEqualTo("%a\\\\b%");
    }

    @Test
    void typedWordsAreBoundNeverConcatenated() {
        String typed = "x' or 1=1 --";
        SearchText t = SearchText.of(typed);
        List<String> words = t.wordsFor(SearchType.LEAVE);
        String clauses = GlobalSearchQueries.wordClauses(GlobalSearchQueries.LEAVE_TEXT, words.size());
        assertThat(clauses).doesNotContain("1=1").doesNotContain("x'").contains(":w0").contains(":w" + (words.size() - 1));
        var params = GlobalSearchQueries.params(UUID.randomUUID(), words, 5);
        assertThat(params.getValue("w0")).isEqualTo("%x'%");
        assertThat(params.getValue("limit")).isEqualTo(5);
    }

    @Test
    void noWordsMeansNoWordClauses() {
        assertThat(GlobalSearchQueries.wordClauses(GlobalSearchQueries.POLICY_TEXT, 0)).isEmpty();
    }
}
